package dk.sundhed.ehealth.referenceclients.citizen.mappers;

import org.hl7.fhir.r4.model.*;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PhdIdentifierTest {

    private static final String CPR_SYSTEM = "urn:oid:1.2.208.176.1.2";

    @Test
    void buildsDevicePatientTypeTimestamp() {
        Identifier identifier = PhdIdentifier.of(sysid("74E8FFFEFF051C00"), "1109859996", CPR_SYSTEM,
                VitalSign.OXYGEN_SATURATION, new DateTimeType("2026-09-01T10:00:00+02:00"));

        assertThat(identifier.getSystem()).isEqualTo("http://hl7.org/fhir/uv/phd/StructureDefinition/PhdBaseObservation");
        assertThat(identifier.getValue())
                .isEqualTo("74E8FFFEFF051C00-1109859996-urn:oid:1.2.208.176.1.2-150456-841564800+8");
    }

    @Test
    void timestampIsSecondsSince2000AtItsResolution() {
        // 2021-11-22 11:56:30.567 UTC, the time in the PHD IG's timestamp example.
        assertThat(PhdIdentifier.timestamp(new DateTimeType("2021-11-22T11:56:30.567Z"))).isEqualTo("690897390.567+0");
        assertThat(PhdIdentifier.timestamp(new DateTimeType("2021-11-22T11:56:30Z"))).isEqualTo("690897390+0");
        assertThat(PhdIdentifier.timestamp(new DateTimeType("2021-11-22T07:56:30-04:00"))).isEqualTo("690897390-16");
    }

    @Test
    void periodWithLengthAddsDuration() {
        Period period = new Period()
                .setStartElement(new DateTimeType("2021-11-22T11:56:30.567Z"))
                .setEndElement(new DateTimeType("2021-11-22T11:56:31.567Z"));
        Period instant = new Period()
                .setStartElement(new DateTimeType("2021-11-22T11:56:30Z"))
                .setEndElement(new DateTimeType("2021-11-22T11:56:30Z"));

        assertThat(PhdIdentifier.timestamp(period)).isEqualTo("690897390.567+0..1.000");
        assertThat(PhdIdentifier.timestamp(instant)).isEqualTo("690897390+0");
    }

    @Test
    void deviceIdIsHexCapitalsWithoutSeparatorsPreferringTheSystemId() {
        Device device = new Device();
        device.addIdentifier().setSystem(PhdIdentifier.BLUETOOTH_MAC_SYSTEM).setValue("00:1c:05:00:78:25");
        device.addIdentifier().setValue("4c-4e-49-12-34-56-ff-ff").getType()
                .addCoding(new Coding("http://terminology.hl7.org/CodeSystem/ContinuaDeviceIdentifiers", "SYSID", null));

        assertThat(PhdIdentifier.deviceSystemId(device)).isEqualTo("4C4E49123456FFFF");
    }

    @Test
    void bluetoothAddressIsUsedWhenThereIsNoSystemId() {
        Device device = new Device();
        device.addIdentifier().setSystem(PhdIdentifier.BLUETOOTH_MAC_SYSTEM).setValue("00-1C-05-00-78-25");

        assertThat(PhdIdentifier.deviceSystemId(device)).isEqualTo("001C05007825");
    }

    @Test
    void noIdentifierWithoutAnIeeeDeviceId() {
        Device serialOnly = new Device();
        serialOnly.addIdentifier().setSystem("urn:example:serial").setValue("SN-12345");

        assertThat(PhdIdentifier.of(null, "1109859996", CPR_SYSTEM, VitalSign.HEART_RATE,
                new DateTimeType("2026-09-01T08:00:00Z"))).isNull();
        assertThat(PhdIdentifier.of(serialOnly, "1109859996", CPR_SYSTEM, VitalSign.HEART_RATE,
                new DateTimeType("2026-09-01T08:00:00Z"))).isNull();
    }

    private static Device sysid(String hex) {
        Device device = new Device();
        device.addIdentifier().setSystem(PhdIdentifier.SYSID_SYSTEM).setValue(hex);
        return device;
    }
}
