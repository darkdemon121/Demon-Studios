export function installationCredentials(request) {
  const authorization = request.headers.authorization || "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/i.exec(authorization);
  const installationId = request.headers["x-vibeshift-installation"];
  return {
    installationId: typeof installationId === "string" ? installationId : "",
    installationSecret: match?.[1] || ""
  };
}

export function sendSocialError(response, error, fallback = "Social connection request failed.") {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  response.status(status).json({ error: status < 500 ? error.message : fallback });
}