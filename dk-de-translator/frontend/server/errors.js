// An Error carrying the HTTP status the wallet routes answer with.
export const httpError = (status, message) => Object.assign(new Error(message), { status });
