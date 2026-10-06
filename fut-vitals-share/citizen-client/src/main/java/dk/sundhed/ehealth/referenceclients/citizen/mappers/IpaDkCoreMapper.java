package dk.sundhed.ehealth.referenceclients.citizen.mappers;

import dk.sundhed.ehealth.referenceclients.common.fhir.Observations;
import dk.sundhed.ehealth.referenceclients.common.fhir.PatientDemographics;
import jakarta.annotation.Nullable;
import org.hl7.fhir.r4.model.*;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Function;

/**
 * Turns the citizen's FUT {@link Patient} and vital-sign {@link Observation}s into a transaction
 * {@link Bundle} of DK-Core IPA resources: one {@code ipa-dk-core-patient} and one
 * {@code ipa-dk-core-observation} per measurement, each also claiming its FHIR vital-signs profile
 * ({@code heartrate}, {@code oxygensat} or {@code bp}).
 *
 * <p>What changes on the way:
 * <ul>
 *   <li>Codes get the LOINC coding the vital-signs profiles require; FUT's own codings are kept,
 *       with their OIDs replaced by the code system URLs DK-Core slices on (NPU, MedCom).</li>
 *   <li>Values get UCUM units; an oxygen saturation given as a fraction becomes a percentage.</li>
 *   <li>Blood pressures FUT stores as separate systolic and diastolic Observations are paired by
 *       effective time into one {@code bp} panel. A half without its other half is left out.</li>
 *   <li>Each Observation gets the PHD IG's conditional-create identifier ({@link PhdIdentifier})
 *       when its device is known, and is created only if no Observation with that identifier is in
 *       the record yet, so posting the same measurements twice does not create duplicates. The FUT
 *       Observation it came from is recorded in {@code meta.source}.</li>
 * </ul>
 */
public final class IpaDkCoreMapper {

    public static final String IPA_DK_CORE_PATIENT =
            "http://hl7.dk/fhir/core/StructureDefinition/ipa-dk-core-patient";
    public static final String IPA_DK_CORE_OBSERVATION =
            "http://hl7.dk/fhir/core/StructureDefinition/ipa-dk-core-observation";

    static final String CPR_SYSTEM = "urn:oid:1.2.208.176.1.2";
    static final String UCUM = "http://unitsofmeasure.org";
    /** FUT's business identifier on every Observation it stores. */
    static final String FUT_IDENTIFIER_SYSTEM = "http://ehealth.sundhed.dk/id/ehealth-identifier";

    private static final Map<String, String> DK_CORE_CODE_SYSTEMS = Map.of(
            "urn:oid:1.2.208.176.2.1", "http://npu-terminology.org",
            "urn:oid:1.2.208.184.100.8", "http://medcomfhir.dk/ig/terminology/CodeSystem/medcom-observation-codes");

    private static final CodeableConcept VITAL_SIGNS_CATEGORY = new CodeableConcept(new Coding(
            "http://terminology.hl7.org/CodeSystem/observation-category", "vital-signs", "Vital Signs"));

    private IpaDkCoreMapper() {
    }

    /**
     * Builds the transaction bundle. Observations that are not one of the {@link VitalSign}s are
     * ignored.
     *
     * @param deviceOf the FUT Device a FUT Observation was measured with, or {@code null} when it has
     *                 none or it cannot be read; needed for the PHD identifier
     * @throws IllegalArgumentException when the patient has no CPR number, which DK-Core requires
     */
    public static Bundle toTransaction(
            Patient futPatient, Collection<Observation> futObservations, Function<Observation, Device> deviceOf) {
        Patient patient = toPatient(futPatient);
        String cpr = PatientDemographics.cpr(patient);
        String patientUrl = newUrn();

        Bundle bundle = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        bundle.addEntry()
                .setFullUrl(patientUrl)
                .setResource(patient)
                .getRequest()
                .setMethod(Bundle.HTTPVerb.POST)
                .setUrl("Patient")
                .setIfNoneExist("identifier=" + CPR_SYSTEM + "|" + cpr);

        for (Observation observation : toObservations(futObservations, new Reference(patientUrl), cpr, deviceOf)) {
            Bundle.BundleEntryRequestComponent request = bundle.addEntry()
                    .setFullUrl(newUrn())
                    .setResource(observation)
                    .getRequest()
                    .setMethod(Bundle.HTTPVerb.POST)
                    .setUrl("Observation");
            conditionalCreateKey(observation).ifPresent(key -> request.setIfNoneExist("identifier="
                    + key.getSystem() + "|" + URLEncoder.encode(key.getValue(), StandardCharsets.UTF_8)));
        }
        return bundle;
    }

    /**
     * What the conditional create matches on: the PHD identifier when one could be built, otherwise
     * FUT's own identifier.
     */
    public static Optional<Identifier> conditionalCreateKey(Observation observation) {
        return phdIdentifier(observation).or(() -> observation.getIdentifier().stream()
                .filter(identifier -> FUT_IDENTIFIER_SYSTEM.equals(identifier.getSystem()))
                .findFirst());
    }

    public static Optional<Identifier> phdIdentifier(Observation observation) {
        return observation.getIdentifier().stream()
                .filter(identifier -> PhdIdentifier.SYSTEM.equals(identifier.getSystem()))
                .findFirst();
    }

    /** The FUT Observation an exported one came from (for a paired blood pressure: the systolic one). */
    @Nullable
    public static String sourceOf(Observation observation) {
        return observation.getMeta().getSource();
    }

    /**
     * The FUT patient as an {@code ipa-dk-core-patient}: CPR, names, gender, birth date and
     * addresses. Everything else FUT holds (FUT-specific extensions, managing organisation, ...) is
     * left behind.
     */
    public static Patient toPatient(Patient futPatient) {
        String cpr = PatientDemographics.cpr(futPatient);
        if (cpr == null) {
            throw new IllegalArgumentException("The patient has no CPR number");
        }
        Patient patient = new Patient();
        patient.getMeta().addProfile(IPA_DK_CORE_PATIENT);
        patient.addIdentifier().setSystem(CPR_SYSTEM).setValue(cpr);
        for (HumanName name : futPatient.getName()) {
            HumanName copy = name.copy();
            // DK-Core's official slice requires use = official; the CPR name is the official one.
            if (!copy.hasUse() && copy.hasFamily()) {
                copy.setUse(HumanName.NameUse.OFFICIAL);
            }
            patient.addName(copy);
        }
        patient.setGender(futPatient.getGender());
        patient.setBirthDateElement(futPatient.getBirthDateElement().copy());
        for (Address address : futPatient.getAddress()) {
            patient.addAddress(address.copy());
        }
        return patient;
    }

    /**
     * The vital-sign Observations among {@code futObservations}, as {@code ipa-dk-core-observation}s
     * about {@code subject} (whose CPR number is {@code cpr}), oldest first.
     */
    public static List<Observation> toObservations(Collection<Observation> futObservations, Reference subject,
                                                   String cpr, Function<Observation, Device> deviceOf) {
        Target target = new Target(subject, cpr, deviceOf);
        List<Observation> mapped = new ArrayList<>();
        Map<Date, Observation> systolicByTime = new LinkedHashMap<>();
        Map<Date, Observation> diastolicByTime = new LinkedHashMap<>();

        for (Observation source : futObservations) {
            VitalSign sign = VitalSign.of(source);
            if (sign == null) {
                continue;
            }
            switch (sign) {
                case SYSTOLIC -> systolicByTime.put(Observations.effectiveStart(source), source);
                case DIASTOLIC -> diastolicByTime.put(Observations.effectiveStart(source), source);
                case BLOOD_PRESSURE -> mapped.add(bloodPressure(source, components(source), target));
                default -> mapped.add(singleValue(source, sign, target));
            }
        }
        systolicByTime.forEach((time, systolic) -> {
            Observation diastolic = diastolicByTime.get(time);
            if (time != null && diastolic != null) {
                Observation panel = bloodPressure(systolic, List.of(
                        component(systolic.getCode(), systolic.getValueQuantity(), VitalSign.SYSTOLIC),
                        component(diastolic.getCode(), diastolic.getValueQuantity(), VitalSign.DIASTOLIC)), target);
                mapped.add(panel);
            }
        });

        mapped.sort(Comparator.comparing(Observations::effectiveStart, Comparator.nullsLast(Comparator.naturalOrder())));
        return mapped;
    }

    /** Where the exported Observations go: the subject, its CPR number, and the FUT devices. */
    private record Target(Reference subject, String cpr, Function<Observation, Device> deviceOf) {
    }

    private static Observation singleValue(Observation source, VitalSign sign, Target target) {
        Observation observation = base(source, sign, source.getCode(), target);
        if (source.hasValueQuantity()) {
            observation.setValue(quantity(source.getValueQuantity(), sign));
        }
        return observation;
    }

    private static Observation bloodPressure(
            Observation source, List<Observation.ObservationComponentComponent> components, Target target) {
        // A panel FUT stores as one Observation with components (e.g. SKS ZZ3170) keeps its code; one
        // built from separate systolic/diastolic Observations has no panel code of its own.
        CodeableConcept code = source.hasComponent() || VitalSign.of(source.getCode()) == VitalSign.BLOOD_PRESSURE
                ? source.getCode()
                : new CodeableConcept();
        Observation observation = base(source, VitalSign.BLOOD_PRESSURE, code, target);
        components.forEach(observation::addComponent);
        return observation;
    }

    private static List<Observation.ObservationComponentComponent> components(Observation source) {
        List<Observation.ObservationComponentComponent> components = new ArrayList<>();
        for (Observation.ObservationComponentComponent part : source.getComponent()) {
            VitalSign sign = VitalSign.of(part.getCode());
            if ((sign == VitalSign.SYSTOLIC || sign == VitalSign.DIASTOLIC) && part.hasValueQuantity()) {
                components.add(component(part.getCode(), part.getValueQuantity(), sign));
            }
        }
        return components;
    }

    private static Observation.ObservationComponentComponent component(
            CodeableConcept code, Quantity value, VitalSign sign) {
        return new Observation.ObservationComponentComponent()
                .setCode(code(code, sign))
                .setValue(quantity(value, sign));
    }

    private static Observation base(Observation source, VitalSign sign, CodeableConcept code, Target target) {
        Reference subject = target.subject();
        Observation observation = new Observation();
        observation.getMeta().addProfile(IPA_DK_CORE_OBSERVATION).addProfile(sign.profile());
        if (!source.getIdElement().isEmpty()) {
            observation.getMeta().setSource(source.getIdElement().toVersionless().getValue());
        }
        Identifier phd = PhdIdentifier.of(
                target.deviceOf().apply(source), target.cpr(), CPR_SYSTEM, sign, source.getEffective());
        if (phd != null) {
            observation.addIdentifier(phd);
        }
        // FUT's own business identifier (a UUID). Only the first: further ones FUT adds to a blood
        // pressure identify its components (suffixed _DNK05472 / _DNK05473).
        source.getIdentifier().stream()
                .filter(id -> FUT_IDENTIFIER_SYSTEM.equals(id.getSystem()) && id.hasValue())
                .findFirst()
                .ifPresent(id -> observation.addIdentifier(id.copy()));
        observation.setStatus(source.hasStatus() ? source.getStatus() : Observation.ObservationStatus.FINAL);
        observation.addCategory(VITAL_SIGNS_CATEGORY.copy());
        observation.setCode(code(code, sign));
        observation.setSubject(subject.copy());
        observation.setEffective(source.getEffective() != null ? source.getEffective().copy() : null);
        // Measurements in FUT are entered by the citizen, at home.
        observation.addPerformer(subject.copy());
        return observation;
    }

    /** LOINC first, then FUT's own codings with DK-Core code system URLs. */
    private static CodeableConcept code(CodeableConcept source, VitalSign sign) {
        CodeableConcept code = new CodeableConcept().addCoding(sign.loinc());
        for (Coding coding : source.getCoding()) {
            if (sign.loinc().getSystem().equals(coding.getSystem())) {
                continue;
            }
            Coding copy = coding.copy();
            copy.setSystem(DK_CORE_CODE_SYSTEMS.getOrDefault(coding.getSystem(), coding.getSystem()));
            code.addCoding(copy);
        }
        code.setText(source.hasText() ? source.getText() : sign.label());
        return code;
    }

    private static Quantity quantity(Quantity source, VitalSign sign) {
        BigDecimal value = source.getValue();
        if (sign == VitalSign.OXYGEN_SATURATION && value != null && isFraction(source)) {
            value = value.movePointRight(2);
        }
        return new Quantity()
                .setValue(value)
                .setSystem(UCUM)
                .setCode(sign.ucumUnit())
                .setUnit(sign.ucumUnit());
    }

    /** NPU reports saturation as a fraction (unit "1" or none, value at most 1). */
    private static boolean isFraction(Quantity quantity) {
        String unit = quantity.hasCode() ? quantity.getCode() : quantity.getUnit();
        boolean dimensionless = unit == null || unit.isBlank() || "1".equals(unit);
        return dimensionless && quantity.getValue().compareTo(BigDecimal.ONE) <= 0;
    }

    private static String newUrn() {
        return "urn:uuid:" + UUID.randomUUID();
    }
}
