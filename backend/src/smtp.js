const net = require("node:net");
const tls = require("node:tls");

function sendEnquiry(config, recipient, enquiry) {
  const safeFrom = validateAddress(config.from, "SMTP_FROM");
  const safeRecipient = validateAddress(recipient, "CONTACT_RECIPIENT_EMAIL");
  const safeReplyTo = validateAddress(enquiry.email, "enquiry email");
  const safeService = validateHeaderText(enquiry.service, "service");
  return new Promise((resolve, reject) => {
    let socket;
    let buffer = "";
    let responseCode = null;
    let step = 0;
    let stage = config.secure ? "tls_handshake" : "connection";
    const commands = [
      { code: 220, command: null, stage: "greeting" },
      { code: 250, command: "EHLO fetmandigital.local", stage: "ehlo" },
      ...(config.secure ? [] : [{ code: 220, command: "STARTTLS", upgrade: true, stage: "starttls" }]),
      ...(config.secure ? [] : [{ code: 250, command: "EHLO fetmandigital.local", stage: "ehlo" }]),
      { code: 334, command: "AUTH LOGIN", stage: "authentication" },
      { code: 334, command: Buffer.from(config.user).toString("base64"), stage: "authentication" },
      { code: 235, command: Buffer.from(config.password).toString("base64"), stage: "authentication" },
      { code: 250, command: `MAIL FROM:<${safeFrom}>`, stage: "mail_from" },
      { code: 250, command: `RCPT TO:<${safeRecipient}>`, stage: "recipient" },
      { code: 354, command: "DATA", stage: "message_data" },
      { code: 250, command: buildMessage(safeFrom, safeRecipient, { ...enquiry, email: safeReplyTo, service: safeService }), stage: "message_acceptance" },
      { code: 221, command: "QUIT", stage: "quit" },
    ];
    const fail = (category, errorCode, smtpCode) => {
      socket?.destroy();
      const error = new Error("SMTP delivery failed.");
      error.diagnostic = { stage, category, ...(errorCode ? { errorCode } : {}), ...(smtpCode ? { smtpCode } : {}) };
      reject(error);
    };
    const next = () => {
      const current = commands[step++];
      if (!current) return resolve();
      if (current.command === null) return;
      stage = current.stage;
      try {
        socket.write(`${current.command}\r\n`);
      } catch (error) {
        fail(categoryForSocketError(error, stage), safeErrorCode(error));
      }
    };
    const processResponse = (code) => {
      const current = commands[step - 1];
      if (code !== current.code) {
        const diagnostic = smtpResponseDiagnostic(current.stage, code);
        return fail(diagnostic.category, undefined, diagnostic.smtpCode);
      }
      if (current.upgrade) {
        stage = "tls_handshake";
        socket.removeListener("data", onData);
        socket = tls.connect({ socket, host: config.host, ...(net.isIP(config.host) ? {} : { servername: config.host }), rejectUnauthorized: true }, () => {
          stage = "greeting";
          socket.on("data", onData);
          next();
        });
        socket.on("error", (error) => fail(categoryForSocketError(error, stage), safeErrorCode(error)));
        return;
      }
      if (current.code === 354) { socket.write(`${commands[step++].command}\r\n`); return; }
      next();
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const match = /^(\d{3})([ -])/.exec(line);
        if (!match) return fail("protocol", undefined);
        const code = Number(match[1]);
        if (responseCode !== null && responseCode !== code) return fail("protocol", undefined, code);
        responseCode = code;
        if (match[2] === "-") continue;
        responseCode = null;
        processResponse(code);
        if (socket?.destroyed) return;
      }
    };
    socket = config.secure ? tls.connect({ host: config.host, port: config.port, ...(net.isIP(config.host) ? {} : { servername: config.host }), rejectUnauthorized: true }) : net.connect({ host: config.host, port: config.port });
    socket.setTimeout(15000, () => fail(stage === "connection" || stage === "tls_handshake" ? stage : "timeout", "ETIMEDOUT"));
    socket.on("error", (error) => fail(categoryForSocketError(error, stage), safeErrorCode(error)));
    socket.on("data", onData);
    if (config.secure) socket.on("secureConnect", () => { stage = "greeting"; next(); });
    else socket.on("connect", () => { stage = "greeting"; next(); });
  });
}

function categoryForSocketError(error, stage) {
  const code = safeErrorCode(error) || "";
  if (stage === "tls_handshake" || /^(?:ERR_TLS|ERR_SSL|CERT_|DEPTH_ZERO_|UNABLE_TO_VERIFY)/.test(code)) return "tls";
  if (stage === "authentication") return "authentication";
  if (stage === "connection") return "connection";
  return "transport";
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : undefined;
}
function smtpResponseDiagnostic(stage, smtpCode) {
  return { stage, category: stage === "authentication" ? "authentication" : "smtp_rejected", smtpCode };
}

function buildMessage(from, recipient, enquiry) {
  const safeFrom = validateAddress(from, "From");
  const safeRecipient = validateAddress(recipient, "To");
  const safeReplyTo = validateAddress(enquiry.email, "Reply-To");
  const safeService = validateHeaderText(enquiry.service, "service");
  const subject = encodeMimeHeader(`Fetman Digital project enquiry — ${safeService}`);
  const body = [
    `Name: ${String(enquiry.fullName).replace(/[\r\n]/g, " ")}`,
    `Email: ${safeReplyTo}`,
    `Service: ${safeService}`,
    "",
    String(enquiry.message).replace(/\r\n|\r|\n/g, "\r\n").replace(/^\./gm, ".."),
  ].join("\r\n");
  return `From: ${safeFrom}\r\nTo: ${safeRecipient}\r\nSubject: ${subject}\r\nReply-To: ${safeReplyTo}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.`;
}

function validateAddress(value, label) {
  if (typeof value !== "string" || value.length > 254 || /[\r\n\x00-\x1f\x7f]/.test(value) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function validateHeaderText(value, label) {
  if (typeof value !== "string" || value.length > 200 || /[\r\n\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function encodeMimeHeader(value) {
  return /[^\x20-\x7e]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

module.exports = { buildMessage, sendEnquiry, smtpResponseDiagnostic };
