package dk.sundhed.ehealth.referenceclients.citizen.fhir;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.interceptor.BasicAuthInterceptor;
import org.hl7.fhir.r4.model.Bundle;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Writes to the citizen's personal health record: a plain FHIR server outside FUT (by default the
 * hackathon's shared Danish source, {@code datasource1}), where other components such as the DK → DE
 * translator pick the data up.
 *
 * <p>Unlike the FUT servers it is not called with the citizen's token but with the basic-auth
 * credentials in {@code phr.username} / {@code phr.password}.
 */
@Component
public class PersonalHealthRecordAPI {

    private final FhirContext fhirContext;
    private final String baseUrl;
    private final String username;
    private final String password;

    public PersonalHealthRecordAPI(
            FhirContext fhirContext,
            @Value("${phr.url}") String baseUrl,
            @Value("${phr.username:}") String username,
            @Value("${phr.password:}") String password) {
        this.fhirContext = fhirContext;
        this.baseUrl = baseUrl;
        this.username = username;
        this.password = password;
    }

    public String baseUrl() {
        return baseUrl;
    }

    /**
     * POSTs {@code transaction} to the server base and returns the transaction-response Bundle.
     */
    public Bundle transaction(Bundle transaction) {
        return client().transaction().withBundle(transaction).execute();
    }

    private IGenericClient client() {
        IGenericClient client = fhirContext.newRestfulGenericClient(baseUrl);
        if (!username.isBlank()) {
            client.registerInterceptor(new BasicAuthInterceptor(username, password));
        }
        return client;
    }
}
