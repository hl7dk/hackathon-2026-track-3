package dk.sundhed.ehealth.referenceclients.citizen.mappers;

import jakarta.annotation.Nullable;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Observation;

import java.util.Set;

/**
 * The vital signs this module shares, with the codes FUT uses for them and the FHIR vital-signs
 * profile, LOINC code and UCUM unit each one is exported with.
 *
 * <p>FUT codes measurements with NPU (and DNK-prefixed national NPU extensions) under the OID
 * {@code urn:oid:1.2.208.176.2.1}, and with MedCom codes under {@code urn:oid:1.2.208.184.100.8}.
 * LOINC codes are recognised too, so data that already carries them maps the same way.
 */
public enum VitalSign {

    HEART_RATE(
            "Heart rate",
            "149546",
            "http://hl7.org/fhir/StructureDefinition/heartrate",
            "8867-4", "Heart rate",
            "/min",
            Set.of("urn:oid:1.2.208.176.2.1|NPU21692", "http://loinc.org|8867-4")),

    OXYGEN_SATURATION(
            "Oxygen saturation",
            "150456",
            "http://hl7.org/fhir/StructureDefinition/oxygensat",
            "2708-6", "Oxygen saturation in Arterial blood",
            "%",
            Set.of("urn:oid:1.2.208.176.2.1|NPU03011", "http://loinc.org|2708-6", "http://loinc.org|59408-5")),

    BLOOD_PRESSURE(
            "Blood pressure",
            "150020",
            "http://hl7.org/fhir/StructureDefinition/bp",
            "85354-9", "Blood pressure panel with all children optional",
            "mm[Hg]",
            Set.of("http://loinc.org|85354-9")),

    SYSTOLIC(
            "Systolic blood pressure",
            "150021",
            null,
            "8480-6", "Systolic blood pressure",
            "mm[Hg]",
            Set.of("urn:oid:1.2.208.176.2.1|DNK05472", "http://loinc.org|8480-6")),

    DIASTOLIC(
            "Diastolic blood pressure",
            "150022",
            null,
            "8462-4", "Diastolic blood pressure",
            "mm[Hg]",
            Set.of("urn:oid:1.2.208.176.2.1|DNK05473", "http://loinc.org|8462-4"));

    private final String label;
    private final String mdcCode;
    private final String profile;
    private final String loincCode;
    private final String loincDisplay;
    private final String ucumUnit;
    private final Set<String> sourceCodes;

    VitalSign(String label, String mdcCode, @Nullable String profile, String loincCode, String loincDisplay,
              String ucumUnit, Set<String> sourceCodes) {
        this.label = label;
        this.mdcCode = mdcCode;
        this.profile = profile;
        this.loincCode = loincCode;
        this.loincDisplay = loincDisplay;
        this.ucumUnit = ucumUnit;
        this.sourceCodes = sourceCodes;
    }

    public String label() {
        return label;
    }

    /**
     * The IEEE 11073-10101 (MDC) type code, as a decimal number, for the PHD conditional-create
     * identifier. A heart rate is taken to come from a blood pressure monitor
     * ({@code MDC_PULS_RATE_NON_INV}); a pulse oximeter would report {@code MDC_PULS_OXIM_PULS_RATE}
     * (149530), which FUT data cannot tell apart.
     */
    public String mdcCode() {
        return mdcCode;
    }

    /**
     * The FHIR vital-signs profile an exported Observation claims; {@code null} for the systolic and
     * diastolic parts, which are only exported as components of a {@link #BLOOD_PRESSURE} panel.
     */
    @Nullable
    public String profile() {
        return profile;
    }

    public Coding loinc() {
        return new Coding("http://loinc.org", loincCode, loincDisplay);
    }

    public String ucumUnit() {
        return ucumUnit;
    }

    /**
     * The vital sign {@code concept} codes for, or {@code null} when none of its codings is one this
     * module knows.
     */
    @Nullable
    public static VitalSign of(CodeableConcept concept) {
        for (Coding coding : concept.getCoding()) {
            String key = coding.getSystem() + "|" + coding.getCode();
            for (VitalSign sign : values()) {
                if (sign.sourceCodes.contains(key)) {
                    return sign;
                }
            }
        }
        return null;
    }

    /**
     * The vital sign {@code observation} records. An Observation whose own code is unknown but which
     * carries both a systolic and a diastolic component is a blood pressure.
     */
    @Nullable
    public static VitalSign of(Observation observation) {
        VitalSign sign = of(observation.getCode());
        if (sign != null) {
            return sign;
        }
        boolean systolic = false;
        boolean diastolic = false;
        for (Observation.ObservationComponentComponent component : observation.getComponent()) {
            VitalSign part = of(component.getCode());
            systolic |= part == SYSTOLIC;
            diastolic |= part == DIASTOLIC;
        }
        return systolic && diastolic ? BLOOD_PRESSURE : null;
    }
}
