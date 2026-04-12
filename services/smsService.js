const DEFAULT_PROVIDER = "generic-http";

function normalizeText(value) {
  return String(value || "").trim();
}

async function sendSms({ to, message }) {
  const recipient = normalizeText(to);
  const body = normalizeText(message);
  const enabled = normalizeText(process.env.SMS_ENABLED).toLowerCase() === "true";
  const provider = normalizeText(process.env.SMS_PROVIDER) || DEFAULT_PROVIDER;
  const endpoint = normalizeText(process.env.SMS_API_URL);
  const apiKey = normalizeText(process.env.SMS_API_KEY);
  const senderId = normalizeText(process.env.SMS_SENDER_ID);

  if (!recipient || !body) {
    throw new Error("SMS recipient and message are required");
  }

  if (!enabled) {
    return {
      provider,
      status: "skipped",
      skipped: true,
      reason: "SMS sending is disabled"
    };
  }

  if (!endpoint || !apiKey) {
    return {
      provider,
      status: "skipped",
      skipped: true,
      reason: "SMS provider is not fully configured"
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      to: recipient,
      message: body,
      senderId
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || "SMS request failed");
    error.details = data;
    throw error;
  }

  return {
    provider,
    status: "sent",
    skipped: false,
    externalId: normalizeText(data.id || data.messageId || data.sid),
    response: data
  };
}

module.exports = {
  sendSms
};
