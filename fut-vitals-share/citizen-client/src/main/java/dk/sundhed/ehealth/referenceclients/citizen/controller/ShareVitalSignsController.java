package dk.sundhed.ehealth.referenceclients.citizen.controller;

import ca.uhn.fhir.context.FhirContext;
import dk.sundhed.ehealth.referenceclients.citizen.fhir.CitizenDeviceAPI;
import dk.sundhed.ehealth.referenceclients.citizen.fhir.CitizenEpisodeOfCareAPI;
import dk.sundhed.ehealth.referenceclients.citizen.fhir.CitizenMeasurementAPI;
import dk.sundhed.ehealth.referenceclients.citizen.fhir.CitizenPatientAPI;
import dk.sundhed.ehealth.referenceclients.citizen.fhir.PersonalHealthRecordAPI;
import dk.sundhed.ehealth.referenceclients.citizen.mappers.IpaDkCoreMapper;
import dk.sundhed.ehealth.referenceclients.citizen.mappers.VitalSign;
import dk.sundhed.ehealth.referenceclients.citizen.view.SharedVitalSignView;
import dk.sundhed.ehealth.referenceclients.common.fhir.BaseUrlResolver;
import dk.sundhed.ehealth.referenceclients.common.fhir.BundleUtil;
import dk.sundhed.ehealth.referenceclients.common.fhir.FhirServer;
import dk.sundhed.ehealth.referenceclients.common.security.EHealthContext;
import org.hl7.fhir.r4.model.*;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * {@code /share}: the citizen picks vital signs (heart rate, oxygen saturation, blood pressure)
 * from their FUT measurements and shares them, converted to DK-Core IPA resources, to their
 * personal health record ({@link PersonalHealthRecordAPI}). From there the DK → DE translator sends
 * them on to the German GP.
 *
 * <ul>
 *   <li>{@code GET /share} lists the vital signs as they will be exported, all selected.</li>
 *   <li>{@code POST /share} with {@code action=send} posts the selected ones as a transaction and
 *       shows the server's response; with {@code action=download} returns the transaction Bundle
 *       as a JSON file instead, for use with other tools.</li>
 * </ul>
 *
 * <p>Measurements are read again on POST rather than kept in the session, so the page is stateless.
 */
@Controller
public class ShareVitalSignsController {

    // How far back to look for measurements.
    private static final int LOOKBACK_DAYS = 365;
    private static final ZoneId ZONE = ZoneId.systemDefault();

    private final CitizenPatientAPI patientApi;
    private final CitizenEpisodeOfCareAPI episodeApi;
    private final CitizenMeasurementAPI measurementApi;
    private final CitizenDeviceAPI deviceApi;
    private final PersonalHealthRecordAPI phrApi;
    private final BaseUrlResolver baseUrlResolver;
    private final FhirContext fhirContext;

    public ShareVitalSignsController(
            CitizenPatientAPI patientApi,
            CitizenEpisodeOfCareAPI episodeApi,
            CitizenMeasurementAPI measurementApi,
            CitizenDeviceAPI deviceApi,
            PersonalHealthRecordAPI phrApi,
            BaseUrlResolver baseUrlResolver,
            FhirContext fhirContext) {
        this.patientApi = patientApi;
        this.episodeApi = episodeApi;
        this.measurementApi = measurementApi;
        this.deviceApi = deviceApi;
        this.phrApi = phrApi;
        this.baseUrlResolver = baseUrlResolver;
        this.fhirContext = fhirContext;
    }

    @GetMapping("/share")
    public String share(EHealthContext context, Model model) {
        Bundle transaction = transaction(context);
        model.addAttribute("vitalSigns", SharedVitalSignView.from(BundleUtil.extract(transaction, Observation.class)));
        model.addAttribute("phrUrl", phrApi.baseUrl());
        return "share";
    }

    /**
     * Diagnostics for the PHD identifier: every vital-sign Observation from FUT with the Device it
     * points to (or why that could not be read), as raw FHIR JSON. Also written to
     * {@code target/share-debug.json} in the working directory.
     */
    @GetMapping(value = "/share/debug", produces = "application/json")
    @ResponseBody
    public String debug(EHealthContext context) throws IOException {
        var parser = fhirContext.newJsonParser();
        List<String> rows = new ArrayList<>();
        for (Observation observation : myVitalSigns(context)) {
            String deviceUrl = observation.getDevice().getReference();
            String device = "null";
            String error = null;
            if (deviceUrl != null) {
                CitizenDeviceAPI.Lookup lookup = deviceApi.lookup(deviceUrl, context);
                device = lookup.device() != null ? parser.encodeResourceToString(lookup.device()) : "null";
                error = lookup.error();
            }
            rows.add("{\"observation\":" + parser.encodeResourceToString(observation)
                    + ",\"deviceReference\":" + (deviceUrl == null ? "null" : "\"" + deviceUrl + "\"")
                    + ",\"device\":" + device
                    + ",\"deviceError\":" + (error == null ? "null" : "\"" + error.replace("\"", "'") + "\"") + "}");
        }
        String json = "[" + String.join(",\n", rows) + "]";
        Path out = Path.of("target", "share-debug.json");
        Files.createDirectories(out.getParent());
        Files.writeString(out, json);
        return json;
    }

    @PostMapping(value = "/share", params = "action=download")
    public ResponseEntity<String> download(
            @RequestParam(name = "selected", required = false) List<String> selected, EHealthContext context) {
        String json = fhirContext.newJsonParser().setPrettyPrint(true)
                .encodeResourceToString(selectedTransaction(selected, context));
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf("application/fhir+json"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"vital-signs-bundle.json\"")
                .body(json);
    }

    @PostMapping(value = "/share", params = "action=send")
    public String send(
            @RequestParam(name = "selected", required = false) List<String> selected,
            EHealthContext context,
            Model model) {
        Bundle transaction = selectedTransaction(selected, context);
        Bundle response = phrApi.transaction(transaction);
        model.addAttribute("results", results(transaction, response));
        model.addAttribute("phrUrl", phrApi.baseUrl());
        return "share-result";
    }

    /** One row per transaction entry: what was sent, and whether the server created it or had it already. */
    public record ShareResult(String resourceType, String label, String status, String location) {
    }

    private static List<ShareResult> results(Bundle transaction, Bundle response) {
        List<ShareResult> results = new ArrayList<>();
        for (int i = 0; i < transaction.getEntry().size(); i++) {
            Resource sent = transaction.getEntry().get(i).getResource();
            Bundle.BundleEntryResponseComponent answer = i < response.getEntry().size()
                    ? response.getEntry().get(i).getResponse()
                    : new Bundle.BundleEntryResponseComponent();
            String label = sent instanceof Observation observation
                    ? observation.getCode().getText() + " " + Optional.ofNullable(
                    SharedVitalSignView.from(List.of(observation)).getFirst().when()).orElse("")
                    : "Personal details";
            String status = answer.getStatus() == null ? "-"
                    : answer.getStatus().startsWith("201") ? "Created"
                    : answer.getStatus().startsWith("200") ? "Already shared"
                    : answer.getStatus();
            results.add(new ShareResult(sent.fhirType(), label, status, answer.getLocation()));
        }
        return results;
    }

    /**
     * The transaction for the selected Observations (by FUT source URL) plus the Patient. No
     * selection at all means everything, so a plain download gets the whole set.
     */
    private Bundle selectedTransaction(List<String> selected, EHealthContext context) {
        Bundle transaction = transaction(context);
        if (selected == null || selected.isEmpty()) {
            return transaction;
        }
        Set<String> keep = Set.copyOf(selected);
        transaction.getEntry().removeIf(entry -> entry.getResource() instanceof Observation observation
                && !keep.contains(IpaDkCoreMapper.sourceOf(observation)));
        return transaction;
    }

    /**
     * All the citizen's vital signs as a transaction, each FUT device read once for the PHD
     * identifiers.
     */
    private Bundle transaction(EHealthContext context) {
        Map<String, Optional<Device>> devices = new HashMap<>();
        return IpaDkCoreMapper.toTransaction(patientApi.readSelf(context), myVitalSigns(context), observation -> {
            String deviceUrl = observation.getDevice().getReference();
            return deviceUrl == null
                    ? null
                    : devices.computeIfAbsent(deviceUrl, url -> Optional.ofNullable(deviceApi.read(url, context)))
                    .orElse(null);
        });
    }

    /**
     * The citizen's vital-sign Observations from the last {@value #LOOKBACK_DAYS} days, across all
     * their active episodes of care. The measurement search is per episode, because the
     * measurement server scopes the token to one.
     */
    private List<Observation> myVitalSigns(EHealthContext context) {
        Date start = Date.from(LocalDate.now().minusDays(LOOKBACK_DAYS).atStartOfDay(ZONE).toInstant());
        Map<String, Observation> byId = new LinkedHashMap<>();
        for (EpisodeOfCare episode : episodeApi.listMyActiveEpisodes(context)) {
            Bundle outer = measurementApi.searchMeasurements(episodeUrl(episode), start, context);
            for (Bundle.BundleEntryComponent entry : outer.getEntry()) {
                if (entry.getResource() instanceof Bundle inner) {
                    for (Observation observation : BundleUtil.extract(inner, Observation.class)) {
                        if (VitalSign.of(observation) != null) {
                            byId.putIfAbsent(observation.getIdElement().toVersionless().getValue(), observation);
                        }
                    }
                }
            }
        }
        return List.copyOf(byId.values());
    }

    private String episodeUrl(EpisodeOfCare episode) {
        IdType id = episode.getIdElement().toVersionless();
        return id.isAbsolute()
                ? id.getValue()
                : baseUrlResolver.createId(FhirServer.CARE_PLAN, EpisodeOfCare.class, id.getIdPart());
    }
}
