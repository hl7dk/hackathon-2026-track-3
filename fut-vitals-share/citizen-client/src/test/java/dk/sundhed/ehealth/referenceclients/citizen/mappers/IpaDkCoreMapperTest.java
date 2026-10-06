package dk.sundhed.ehealth.referenceclients.citizen.mappers;

import org.hl7.fhir.r4.model.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IpaDkCoreMapperTest {

    private static final String NPU = "urn:oid:1.2.208.176.2.1";
    private static final Device CUFF = new Device().addIdentifier(new Identifier()
            .setSystem(PhdIdentifier.SYSID_SYSTEM).setValue("74-E8-FF-FE-FF-05-1C-00"));
    private static final String BASE = "https://measurement.devenvcgi.ehealth.sundhed.dk/fhir/Observation/";

    @Test
    void heartRateGetsLoincUcumAndBothProfiles() {
        Observation pulse = observation("1", NPU, "NPU21692", "2026-09-01T08:00:00Z");
        pulse.setValue(new Quantity().setValue(72).setUnit("/min"));

        Observation mapped = map(pulse).getFirst();

        assertThat(mapped.getMeta().getProfile()).extracting(CanonicalType::getValue).containsExactly(
                IpaDkCoreMapper.IPA_DK_CORE_OBSERVATION, "http://hl7.org/fhir/StructureDefinition/heartrate");
        assertThat(mapped.getCode().getCoding()).extracting(Coding::getSystem, Coding::getCode).containsExactly(
                org.assertj.core.groups.Tuple.tuple("http://loinc.org", "8867-4"),
                org.assertj.core.groups.Tuple.tuple("http://npu-terminology.org", "NPU21692"));
        assertThat(mapped.getCategoryFirstRep().getCodingFirstRep().getCode()).isEqualTo("vital-signs");
        assertThat(mapped.getValueQuantity().getSystem()).isEqualTo(IpaDkCoreMapper.UCUM);
        assertThat(mapped.getValueQuantity().getCode()).isEqualTo("/min");
        assertThat(mapped.getSubject().getReference()).isEqualTo("urn:uuid:anne");
        assertThat(mapped.getMeta().getSource()).isEqualTo(BASE + "1");
    }

    @Test
    void oxygenSaturationAsFractionBecomesPercent() {
        Observation spo2 = observation("2", NPU, "NPU03011", "2026-09-01T08:00:00Z");
        spo2.setValue(new Quantity().setValue(new BigDecimal("0.97")));

        Quantity value = map(spo2).getFirst().getValueQuantity();

        assertThat(value.getValue()).isEqualByComparingTo("97");
        assertThat(value.getCode()).isEqualTo("%");
    }

    @Test
    void separateSystolicAndDiastolicArePairedIntoOnePanel() {
        Observation systolic = observation("3", NPU, "DNK05472", "2026-09-01T08:00:00Z");
        systolic.setValue(new Quantity().setValue(128).setUnit("mmHg"));
        Observation diastolic = observation("4", NPU, "DNK05473", "2026-09-01T08:00:00Z");
        diastolic.setValue(new Quantity().setValue(82).setUnit("mmHg"));
        Observation lonelySystolic = observation("5", NPU, "DNK05472", "2026-09-02T08:00:00Z");
        lonelySystolic.setValue(new Quantity().setValue(130).setUnit("mmHg"));

        List<Observation> mapped = map(systolic, diastolic, lonelySystolic);

        assertThat(mapped).hasSize(1);
        Observation panel = mapped.getFirst();
        assertThat(panel.getMeta().getProfile()).extracting(CanonicalType::getValue)
                .contains("http://hl7.org/fhir/StructureDefinition/bp");
        assertThat(panel.getCode().getCodingFirstRep().getCode()).isEqualTo("85354-9");
        assertThat(panel.getComponent()).extracting(c -> c.getCode().getCodingFirstRep().getCode())
                .containsExactly("8480-6", "8462-4");
        assertThat(panel.getComponent()).extracting(c -> c.getValueQuantity().getCode())
                .containsOnly("mm[Hg]");
        assertThat(panel.getMeta().getSource()).isEqualTo(BASE + "3");
    }

    @Test
    void otherMeasurementsAreLeftOut() {
        Observation weight = observation("6", NPU, "NPU03804", "2026-09-01T08:00:00Z");
        weight.setValue(new Quantity().setValue(70).setUnit("kg"));

        assertThat(map(weight)).isEmpty();
    }

    @Test
    void transactionCreatesPatientAndObservationsConditionally() {
        Observation pulse = observation("1", NPU, "NPU21692", "2026-09-01T08:00:00Z");
        pulse.setValue(new Quantity().setValue(72).setUnit("/min"));

        Bundle bundle = IpaDkCoreMapper.toTransaction(anne(), List.of(pulse), o -> CUFF);

        assertThat(bundle.getType()).isEqualTo(Bundle.BundleType.TRANSACTION);
        Bundle.BundleEntryComponent patientEntry = bundle.getEntryFirstRep();
        assertThat(patientEntry.getRequest().getIfNoneExist())
                .isEqualTo("identifier=urn:oid:1.2.208.176.1.2|1109859996");
        Patient patient = (Patient) patientEntry.getResource();
        assertThat(patient.getMeta().getProfile().getFirst().getValue()).isEqualTo(IpaDkCoreMapper.IPA_DK_CORE_PATIENT);
        assertThat(patient.getNameFirstRep().getUse()).isEqualTo(HumanName.NameUse.OFFICIAL);

        Bundle.BundleEntryComponent observationEntry = bundle.getEntry().get(1);
        assertThat(((Observation) observationEntry.getResource()).getSubject().getReference())
                .isEqualTo(patientEntry.getFullUrl());
        assertThat(observationEntry.getRequest().getIfNoneExist()).isEqualTo("identifier="
                + PhdIdentifier.SYSTEM + "|74E8FFFEFF051C00-1109859996-urn%3Aoid%3A1.2.208.176.1.2-149546-841564800%2B0");
    }

    @Test
    void withoutDeviceThereIsNoPhdIdentifierAndNoConditionalCreate() {
        Observation pulse = observation("1", NPU, "NPU21692", "2026-09-01T08:00:00Z");
        pulse.setValue(new Quantity().setValue(72).setUnit("/min"));

        Bundle bundle = IpaDkCoreMapper.toTransaction(anne(), List.of(pulse), o -> null);

        Observation mapped = (Observation) bundle.getEntry().get(1).getResource();
        assertThat(mapped.getIdentifier()).isEmpty();
        assertThat(bundle.getEntry().get(1).getRequest().hasIfNoneExist()).isFalse();
    }

    @Test
    void telmaBloodPressureWithoutDeviceIsCreatedConditionallyOnFutIdentifier() {
        // Shaped like Anne's Telma data: SKS ZZ3170 with NPU components, no device, FUT identifiers.
        Observation bp = observation("177844", "urn:oid:1.2.208.176.2.4", "ZZ3170", "2026-10-06T08:19:16+00:00");
        String fut = IpaDkCoreMapper.FUT_IDENTIFIER_SYSTEM;
        bp.addIdentifier().setSystem(fut).setValue("b752188d-aadb-438a-8593-dbb02ab2d076");
        bp.addIdentifier().setSystem(fut).setValue("f90e9416-6f86-465d-9bf9-9e0656b5477e_DNK05472");
        bp.addComponent().setValue(new Quantity().setValue(142).setUnit("mm[Hg]"))
                .getCode().addCoding(new Coding(NPU, "DNK05472", null));
        bp.addComponent().setValue(new Quantity().setValue(90).setUnit("mm[Hg]"))
                .getCode().addCoding(new Coding(NPU, "DNK05473", null));

        Bundle bundle = IpaDkCoreMapper.toTransaction(anne(), List.of(bp), o -> null);

        Observation mapped = (Observation) bundle.getEntry().get(1).getResource();
        assertThat(mapped.getMeta().getProfile()).extracting(CanonicalType::getValue)
                .contains("http://hl7.org/fhir/StructureDefinition/bp");
        assertThat(mapped.getCode().getCoding()).extracting(Coding::getCode).containsExactly("85354-9", "ZZ3170");
        assertThat(mapped.getIdentifier()).extracting(Identifier::getValue)
                .containsExactly("b752188d-aadb-438a-8593-dbb02ab2d076");
        assertThat(bundle.getEntry().get(1).getRequest().getIfNoneExist())
                .isEqualTo("identifier=" + fut + "|b752188d-aadb-438a-8593-dbb02ab2d076");
    }

    @Test
    void patientWithoutCprIsRejected() {
        assertThatThrownBy(() -> IpaDkCoreMapper.toPatient(new Patient()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static List<Observation> map(Observation... observations) {
        return IpaDkCoreMapper.toObservations(List.of(observations), new Reference("urn:uuid:anne"), "1109859996", o -> null);
    }

    private static Observation observation(String id, String system, String code, String effective) {
        Observation observation = new Observation();
        observation.setId(BASE + id);
        observation.setStatus(Observation.ObservationStatus.FINAL);
        observation.getCode().addCoding(new Coding(system, code, null));
        observation.setEffective(new DateTimeType(effective));
        return observation;
    }

    private static Patient anne() {
        Patient patient = new Patient();
        patient.addIdentifier().setSystem("urn:oid:1.2.208.176.1.2").setValue("1109859996");
        patient.addName().setFamily("Sørensen").addGiven("Anne");
        patient.setGender(Enumerations.AdministrativeGender.FEMALE);
        patient.setBirthDateElement(new DateType("1985-09-11"));
        return patient;
    }
}
