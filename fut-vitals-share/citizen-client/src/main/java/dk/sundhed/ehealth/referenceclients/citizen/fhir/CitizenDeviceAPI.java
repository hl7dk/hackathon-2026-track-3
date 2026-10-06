package dk.sundhed.ehealth.referenceclients.citizen.fhir;

import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.server.exceptions.BaseServerResponseException;
import dk.sundhed.ehealth.referenceclients.common.fhir.FhirClientFactory;
import dk.sundhed.ehealth.referenceclients.common.fhir.FhirServer;
import dk.sundhed.ehealth.referenceclients.common.security.EHealthContext;
import jakarta.annotation.Nullable;
import org.hl7.fhir.r4.model.Device;
import org.hl7.fhir.r4.model.IdType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Citizen-side read of a {@link Device} on {@code fut-device}: the device a measurement was taken
 * with, as referenced from {@code Observation.device}.
 */
@Component
public class CitizenDeviceAPI {

    private static final Logger log = LoggerFactory.getLogger(CitizenDeviceAPI.class);

    private final FhirClientFactory fhirClientFactory;

    public CitizenDeviceAPI(FhirClientFactory fhirClientFactory) {
        this.fhirClientFactory = fhirClientFactory;
    }

    /**
     * Reads the Device at {@code deviceUrl} (fully qualified), or returns {@code null} when the
     * server refuses or does not have it: a missing device only means the measurement gets no PHD
     * identifier, so it should not stop the citizen from sharing.
     */
    @Nullable
    public Device read(String deviceUrl, EHealthContext context) {
        return lookup(deviceUrl, context).device();
    }

    /** The Device, or why it could not be read. */
    public record Lookup(@Nullable Device device, @Nullable String error) {
    }

    public Lookup lookup(String deviceUrl, EHealthContext context) {
        try {
            IGenericClient client = fhirClientFactory.createClient(FhirServer.DEVICE, context);
            return new Lookup(client.read().resource(Device.class)
                    .withId(new IdType(deviceUrl).toUnqualifiedVersionless()).execute(), null);
        } catch (BaseServerResponseException e) {
            log.warn("Could not read device {}: {} {}", deviceUrl, e.getStatusCode(), e.getMessage());
            return new Lookup(null, e.getStatusCode() + " " + e.getMessage());
        }
    }
}
