package dk.sundhed.ehealth.referenceclients.citizen.mappers;

import ca.uhn.fhir.model.api.TemporalPrecisionEnum;
import jakarta.annotation.Nullable;
import org.hl7.fhir.r4.model.*;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Builds the PHD IG's conditional-create identifier for an Observation
 * (<a href="https://hl7.org/fhir/uv/phd/StructureDefinition-PhdBaseObservation.html#ccidentifier">PhdBaseObservation,
 * Identifier</a>):
 *
 * <pre>device-patient-type-timestamp[..duration]</pre>
 *
 * <ul>
 *   <li><b>device</b>: the PHD's IEEE 11073 system identifier in hex, capitals, no dashes (16
 *       characters for an EUI-64, 12 for an EUI-48 transport address), taken from the FUT
 *       {@link Device}'s identifiers.</li>
 *   <li><b>patient</b>: {@code Patient.identifier.value-Patient.identifier.system}, here the CPR
 *       number and {@code urn:oid:1.2.208.176.1.2}.</li>
 *   <li><b>type</b>: the MDC code as a decimal number ({@link VitalSign#mdcCode()}).</li>
 *   <li><b>timestamp</b>: per "Generating the PHD Reported Timestamp Identifier": seconds since
 *       2000-01-01 at the timestamp's resolution (whole seconds, or three decimals when the time has
 *       milliseconds), followed by the UTC offset in 15-minute units with its sign (e.g. {@code +8}
 *       for +02:00), and {@code ..duration} when the measurement spans a period.</li>
 * </ul>
 *
 * <p>Supplemental-Types codes are never present in FUT data, so that part is always empty.
 *
 * <p>The PHD IG wants the timestamp the device reported, not a possibly corrected
 * {@code effective[x]}. FUT keeps only {@code effective[x]}, so that is what is used. The
 * identifier therefore matches one made by another PHD gateway only if FUT received the device's
 * time unchanged and as UTC time with offset.
 */
public final class PhdIdentifier {

    public static final String SYSTEM = "http://hl7.org/fhir/uv/phd/StructureDefinition/PhdBaseObservation";

    /** IEEE 11073 system identifier (EUI-64), as PHD and Continua identify a device. */
    static final String SYSID_SYSTEM = "urn:oid:1.2.840.10004.1.1.1.0.0.1.0.0.1.2680";
    static final String BLUETOOTH_MAC_SYSTEM = "http://hl7.org/fhir/sid/eui-48/bluetooth";
    private static final String DEVICE_ID_TYPES = "http://terminology.hl7.org/CodeSystem/ContinuaDeviceIdentifiers";

    private static final long EPOCH_2000 = Instant.parse("2000-01-01T00:00:00Z").getEpochSecond();

    private PhdIdentifier() {
    }

    /**
     * The identifier for a measurement of {@code sign} at {@code effective} by {@code device} on the
     * patient with CPR number {@code cpr}, or {@code null} when it cannot be built: no device, a
     * device without an IEEE system identifier (e.g. a measurement typed in by hand), or no time.
     */
    @Nullable
    public static Identifier of(@Nullable Device device, String cpr, String cprSystem, VitalSign sign,
                                @Nullable Type effective) {
        String deviceId = deviceSystemId(device);
        String timestamp = timestamp(effective);
        if (deviceId == null || timestamp == null) {
            return null;
        }
        return new Identifier()
                .setSystem(SYSTEM)
                .setValue(deviceId + "-" + cpr + "-" + cprSystem + "-" + sign.mdcCode() + "-" + timestamp);
    }

    /**
     * The device's IEEE system identifier in hex, capitals, no separators: an EUI-64 system id if
     * the device has one, otherwise an EUI-48 (Bluetooth) address. Recognised by system or by the
     * Continua identifier type ({@code SYSID}, {@code BTMAC}).
     */
    @Nullable
    static String deviceSystemId(@Nullable Device device) {
        if (device == null) {
            return null;
        }
        String eui48 = null;
        for (Identifier identifier : device.getIdentifier()) {
            String hex = hex(identifier.getValue());
            if (hex == null) {
                continue;
            }
            if ((SYSID_SYSTEM.equals(identifier.getSystem()) || hasType(identifier, "SYSID")) && hex.length() == 16) {
                return hex;
            }
            if ((BLUETOOTH_MAC_SYSTEM.equals(identifier.getSystem()) || hasType(identifier, "BTMAC")) && hex.length() == 12) {
                eui48 = hex;
            }
        }
        return eui48;
    }

    /**
     * {@code effective[x]} encoded as a PHD reported timestamp, or {@code null} without one. A
     * period contributes its start and, when it has a length, a duration.
     */
    @Nullable
    static String timestamp(@Nullable Type effective) {
        if (effective instanceof DateTimeType dateTime && dateTime.getValue() != null) {
            return instant(dateTime);
        }
        if (effective instanceof Period period && period.hasStart()) {
            String start = instant(period.getStartElement());
            if (period.hasEnd()) {
                Duration length = Duration.between(
                        period.getStart().toInstant(), period.getEnd().toInstant());
                if (!length.isNegative() && !length.isZero()) {
                    return start + ".." + seconds(length.toMillis(), hasMillis(period.getStartElement()));
                }
            }
            return start;
        }
        return null;
    }

    private static String instant(DateTimeType dateTime) {
        Instant instant = dateTime.getValue().toInstant();
        long millis = (instant.getEpochSecond() - EPOCH_2000) * 1000 + instant.getNano() / 1_000_000;
        String encoded = seconds(millis, hasMillis(dateTime));
        TimeZone zone = dateTime.getTimeZone();
        if (zone != null) {
            int quarters = zone.getOffset(dateTime.getValue().getTime()) / (15 * 60 * 1000);
            encoded += (quarters < 0 ? "-" : "+") + Math.abs(quarters);
        }
        return encoded;
    }

    /** Whole seconds, or seconds with three decimals at millisecond resolution. */
    private static String seconds(long millis, boolean millisecondResolution) {
        BigDecimal seconds = BigDecimal.valueOf(millis, 3);
        return millisecondResolution
                ? seconds.toPlainString()
                : seconds.setScale(0, java.math.RoundingMode.FLOOR).toPlainString();
    }

    private static boolean hasMillis(DateTimeType dateTime) {
        return dateTime.getPrecision() == TemporalPrecisionEnum.MILLI;
    }

    private static boolean hasType(Identifier identifier, String code) {
        return identifier.getType().getCoding().stream()
                .anyMatch(coding -> DEVICE_ID_TYPES.equals(coding.getSystem()) && code.equals(coding.getCode()));
    }

    /** The value as capital hex without separators, or {@code null} if it is not hex. */
    @Nullable
    private static String hex(@Nullable String value) {
        if (value == null) {
            return null;
        }
        String hex = value.replaceAll("[-:.\\s]", "").toUpperCase(Locale.ROOT);
        return hex.matches("[0-9A-F]+") ? hex : null;
    }
}
