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
    let step = 0;
    const commands = [
      { code: 220, command: null },
      { code: 250, command: `EHLO fetmandigital.local` },
      ...(config.secure ? [] : [{ code: 220, command: "STARTTLS", upgrade: true }]),
      ...(config.secure ? [] : [{ code: 250, command: `EHLO fetmandigital.local` }]),
      { code: 250, command: `AUTH LOGIN` },
      { code: 334, command: Buffer.from(config.user).toString("base64") },
      { code: 235, command: Buffer.from(config.password).toString("base64") },
      { code: 250, command: `MAIL FROM:<${safeFrom}>` },
      { code: 250, command: `RCPT TO:<${safeRecipient}>` },
      { code: 354, command: "DATA" },
      { code: 250, command: buildMessage(safeFrom, safeRecipient, { ...enquiry, email: safeReplyTo, service: safeService }) },
      { code: 221, command: "QUIT" },
    ];
    const fail = (error) => { socket?.destroy(); reject(error); };
    const next = () => { const current = commands[step++]; if (!current) return resolve(); if (current.command === null) return; socket.write(`${current.command}\r\n`); };
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (!buffer.endsWith("\r\n")) return;
      const lines = buffer.split(/\r\n/).filter(Boolean); const last = lines.at(-1); buffer = "";
      const code = Number(last?.slice(0, 3));
      const current = commands[step - 1];
      if (code !== current.code) return fail(new Error(`SMTP rejected command with code ${code}.`));
      if (current.upgrade) {
        socket.removeListener("data", onData); socket = tls.connect({ socket, servername: config.host, rejectUnauthorized: true }, () => { socket.on("data", onData); next(); }); socket.on("error", fail); return;
      }
      if (current.code === 354) { socket.write(`${commands[step++].command}\r\n`); return; }
      next();
    };
    socket = config.secure ? tls.connect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: true }) : net.connect({ host: config.host, port: config.port });
    socket.setTimeout(15000, () => fail(new Error("SMTP connection timed out."))); socket.on("error", fail); socket.on("data", onData); if (config.secure) socket.on("secureConnect", next); else socket.on("connect", next);
  });
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

module.exports = { buildMessage, sendEnquiry };
