package dk.sundhed.ehealth.referenceclients.citizen.view;

import dk.sundhed.ehealth.referenceclients.citizen.mappers.IpaDkCoreMapper;
import dk.sundhed.ehealth.referenceclients.citizen.mappers.PhdIdentifier;
import dk.sundhed.ehealth.referenceclients.common.fhir.Observations;
import jakarta.annotation.Nullable;
import org.hl7.fhir.r4.model.Observation;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.List;

/**
 * One vital sign on the share page, as it will be exported (already mapped to DK-Core IPA).
 *
 * @param sourceUrl the FUT Observation it came from; the checkbox value the citizen selects by
 * @param duplicateKey  the identifier sharing again is matched on, prefixed PHD or FUT; {@code null} when there is none
 * @param label     what was measured, e.g. {@code "Heart rate"}
 * @param when      formatted effective time
 * @param value     formatted value with UCUM unit, e.g. {@code "72 /min"} or {@code "128 mm[Hg] / 82 mm[Hg]"}
 */
public record SharedVitalSignView(
        String sourceUrl,
        @Nullable String duplicateKey,
        @Nullable String label,
        @Nullable String when,
        @Nullable String value) {

    private static final ZoneId ZONE = ZoneId.systemDefault();
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("d MMM yyyy HH:mm");

    /** Newest first. */
    public static List<SharedVitalSignView> from(List<Observation> exported) {
        return exported.stream()
                .sorted(Observations.BY_EFFECTIVE_DESC)
                .map(SharedVitalSignView::toView)
                .toList();
    }

    private static SharedVitalSignView toView(Observation observation) {
        return new SharedVitalSignView(
                IpaDkCoreMapper.sourceOf(observation),
                IpaDkCoreMapper.conditionalCreateKey(observation)
                        .map(key -> (PhdIdentifier.SYSTEM.equals(key.getSystem()) ? "PHD " : "FUT ") + key.getValue())
                        .orElse(null),
                observation.getCode().getText(),
                formatWhen(Observations.effectiveStart(observation)),
                Observations.formatValue(observation));
    }

    private static String formatWhen(Date instant) {
        return instant == null
                ? null
                : DATE_FORMAT.format(LocalDateTime.ofInstant(instant.toInstant(), ZONE));
    }
}
