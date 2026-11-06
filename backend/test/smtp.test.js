const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");
const { afterEach, describe, it } = require("node:test");
const { sendEnquiry, smtpResponseDiagnostic } = require("../src/smtp");

const servers = [];
const testCertificate = fs.readFileSync(path.join(__dirname, "fixtures/smtp-test-cert.pem"));
const testKey = fs.readFileSync(path.join(__dirname, "fixtures/smtp-test-key.pem"));
const smtpConfig = (port) => ({
  host: "127.0.0.1",
  port,
  secure: false,
  user: "smtp-user-secret",
  password: "smtp-password-secret",
  from: "sender@example.test",
});
const enquiry = {
  fullName: "Private Name",
  email: "private@example.test",
  service: "Private Service",
  message: "Private enquiry message",
};

function createSmtpServer(onCommand) {
  const server = net.createServer((socket) => {
    socket.write("220 smtp.example.test ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const command = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        onCommand(socket, command);
      }
    });
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function createStartTlsSmtpServer(onCommand) {
  const secureContext = tls.createSecureContext({ key: testKey, cert: testCertificate });
  const server = net.createServer((connection) => {
    let stream = connection;
    stream.write("220 smtp.example.test ready\r\n");

    const attachData = (secure) => {
      let buffer = "";
      const onData = (chunk) => {
        buffer += chunk.toString();
        let end;
        while ((end = buffer.indexOf("\r\n")) !== -1) {
          const command = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          onCommand(stream, command, secure, () => {
            stream.removeListener("data", onData);
            stream.write("220 Begin TLS\r\n", () => {
              stream = new tls.TLSSocket(stream, { isServer: true, secureContext });
              attachData(true);
            });
          });
        }
      };
      stream.on("data", onData);
    };

    attachData(false);
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", () => resolve(server));
  });
}

async function withTrustedTestCertificate(callback) {
  const defaultCertificates = tls.getCACertificates("default");
  tls.setDefaultCACertificates([...defaultCertificates, testCertificate]);
  try {
    return await callback();
  } finally {
    tls.setDefaultCACertificates(defaultCertificates);
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("SMTP diagnostics", () => {
  it("waits for the final line of a multiline EHLO response before sending STARTTLS", async () => {
    let startTlsSent = false;
    let authSent = false;
    const server = await createSmtpServer((socket, command) => {
      if (command.startsWith("EHLO ")) socket.write("250-smtp.example.test\r\n250-AUTH LOGIN\r\n250 SIZE 10000\r\n");
      else if (command === "STARTTLS") { startTlsSent = true; socket.write("454 TLS unavailable\r\n"); }
      else if (command === "AUTH LOGIN") authSent = true;
      else socket.write("500 unexpected command\r\n");
    });

    await assert.rejects(sendEnquiry(smtpConfig(server.address().port), "recipient@example.test", enquiry), (error) => {
      assert.equal(error.diagnostic.stage, "starttls");
      assert.equal(error.diagnostic.category, "smtp_rejected");
      assert.equal(error.diagnostic.smtpCode, 454);
      assert.equal(startTlsSent, true);
      assert.equal(authSent, false);
      assert.doesNotMatch(JSON.stringify(error), /smtp-password-secret|smtp-user-secret|Private Name|Private Service|Private enquiry message/);
      return true;
    });
  });
  it("completes AUTH LOGIN over STARTTLS before proceeding to the mail transaction", async () => {
    await withTrustedTestCertificate(async () => {
      const receivedCommands = [];
      const server = await createStartTlsSmtpServer((socket, command, secure, upgrade) => {
        receivedCommands.push(command);
        if (command.startsWith("EHLO ")) {
          socket.write("250-smtp.example.test\r\n250 AUTH LOGIN\r\n");
        } else if (command === "STARTTLS" && !secure) {
          upgrade();
        } else if (command === "AUTH LOGIN" && secure) {
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (command === Buffer.from("smtp-user-secret").toString("base64") && secure) {
          socket.write("334 UGFzc3dvcmQ6\r\n");
        } else if (command === Buffer.from("smtp-password-secret").toString("base64") && secure) {
          socket.write("235 2.7.0 Authentication successful\r\n");
        } else if (command.startsWith("MAIL FROM:") && secure) {
          socket.write("550 Test stopped after authentication\r\n");
        } else {
          socket.write("500 Unexpected command\r\n");
        }
      });
      const config = { ...smtpConfig(server.address().port), host: "localhost" };

      await assert.rejects(
        sendEnquiry(config, "recipient@example.test", enquiry),
        (error) => {
          assert.equal(error.diagnostic.stage, "mail_from");
          assert.equal(error.diagnostic.category, "smtp_rejected");
          assert.equal(error.diagnostic.smtpCode, 550);
          assert.deepEqual(receivedCommands.slice(0, 6), [
            "EHLO fetmandigital.local",
            "STARTTLS",
            "EHLO fetmandigital.local",
            "AUTH LOGIN",
            Buffer.from(config.user).toString("base64"),
            Buffer.from(config.password).toString("base64"),
          ]);
          assert.match(receivedCommands[6], /^MAIL FROM:/);
          assert.doesNotMatch(
            JSON.stringify(error),
            /smtp-password-secret|smtp-user-secret|Private Name|Private Service|Private enquiry message/,
          );
          return true;
        },
      );
    });
  });

  it("reports rejected AUTH LOGIN credentials at the authentication stage", async () => {
    await withTrustedTestCertificate(async () => {
      const receivedCommands = [];
      const server = await createStartTlsSmtpServer((socket, command, secure, upgrade) => {
        receivedCommands.push(command);
        if (command.startsWith("EHLO ")) {
          socket.write("250-smtp.example.test\r\n250 AUTH LOGIN\r\n");
        } else if (command === "STARTTLS" && !secure) {
          upgrade();
        } else if (command === "AUTH LOGIN" && secure) {
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (command === Buffer.from("smtp-user-secret").toString("base64") && secure) {
          socket.write("334 UGFzc3dvcmQ6\r\n");
        } else if (command === Buffer.from("smtp-password-secret").toString("base64") && secure) {
          socket.write("535 5.7.8 Authentication rejected\r\n");
        } else {
          socket.write("500 Unexpected command\r\n");
        }
      });
      const config = { ...smtpConfig(server.address().port), host: "localhost" };

      await assert.rejects(
        sendEnquiry(config, "recipient@example.test", enquiry),
        (error) => {
          assert.deepEqual(error.diagnostic, {
            stage: "authentication",
            category: "authentication",
            smtpCode: 535,
          });
          assert.deepEqual(receivedCommands.slice(0, 6), [
            "EHLO fetmandigital.local",
            "STARTTLS",
            "EHLO fetmandigital.local",
            "AUTH LOGIN",
            Buffer.from(config.user).toString("base64"),
            Buffer.from(config.password).toString("base64"),
          ]);
          return true;
        },
      );
    });
  });

  it("classifies authentication failures separately from other rejected SMTP codes", () => {
    assert.deepEqual(smtpResponseDiagnostic("authentication", 535), {
      stage: "authentication",
      category: "authentication",
      smtpCode: 535,
    });
    assert.deepEqual(smtpResponseDiagnostic("recipient", 550), {
      stage: "recipient",
      category: "smtp_rejected",
      smtpCode: 550,
    });
  });

  it("classifies a TLS handshake failure distinctly", async () => {
    const server = await createSmtpServer((_socket, _command) => {});
    await assert.rejects(
      sendEnquiry({ ...smtpConfig(server.address().port), secure: true }, "recipient@example.test", enquiry),
      (error) => {
        assert.equal(error.diagnostic.stage, "tls_handshake");
        assert.equal(error.diagnostic.category, "tls");
        assert.match(error.diagnostic.errorCode, /^(?:ERR_TLS|ERR_SSL)/);
        return true;
      },
    );
  });

  it("classifies a refused SMTP connection without exposing the configured host credentials", async () => {
    const probe = net.createServer();
    servers.push(probe);
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    servers.splice(servers.indexOf(probe), 1);

    await assert.rejects(sendEnquiry(smtpConfig(port), "recipient@example.test", enquiry), (error) => {
      assert.equal(error.diagnostic.stage, "connection");
      assert.equal(error.diagnostic.category, "connection");
      assert.equal(typeof error.diagnostic.errorCode, "string");
      assert.doesNotMatch(JSON.stringify(error), /smtp-password-secret|smtp-user-secret/);
      return true;
    });
  });
});
