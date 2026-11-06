const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { getEnvironmentAvailability } = require("../src/config/env");

describe("environment availability diagnostics", () => {
  it("reports configured variable presence without returning their values", () => {
    const availability = getEnvironmentAvailability({
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "sender@example.test",
      SMTP_PASSWORD: "secret-value",
      SMTP_FROM: "sender@example.test",
      CONTACT_RECIPIENT_EMAIL: "recipient@example.test",
    });

    assert.deepEqual(availability, {
      SMTP_HOST: true,
      SMTP_PORT: true,
      SMTP_SECURE: true,
      SMTP_USER: true,
      SMTP_PASSWORD: true,
      SMTP_FROM: true,
      CONTACT_RECIPIENT_EMAIL: true,
    });
    assert.doesNotMatch(JSON.stringify(availability), /smtp\.example|sender@example|secret-value|recipient@example/);
  });

  it("reports missing or blank variables as unavailable", () => {
    assert.deepEqual(getEnvironmentAvailability({ SMTP_HOST: " ", SMTP_PASSWORD: "" }), {
      SMTP_HOST: false,
      SMTP_PORT: false,
      SMTP_SECURE: false,
      SMTP_USER: false,
      SMTP_PASSWORD: false,
      SMTP_FROM: false,
      CONTACT_RECIPIENT_EMAIL: false,
    });
  });
});
