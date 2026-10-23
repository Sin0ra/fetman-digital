async function readMaintenanceMode(pool) {
  const [rows] = await pool.execute(
    `SELECT maintenance_mode, version, updated_at
     FROM site_maintenance_settings
     WHERE id = 1
     LIMIT 1`,
  );
  const setting = rows[0];
  if (!setting) {
    throw new Error("The maintenance setting is missing.");
  }
  if (![true, false, 0, 1, "0", "1"].includes(setting.maintenance_mode)) {
    throw new Error("The maintenance setting value is invalid.");
  }
  const maintenanceMode =
    setting.maintenance_mode === true ||
    setting.maintenance_mode === 1 ||
    setting.maintenance_mode === "1";
  const version = Number(setting.version);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error("The maintenance setting version is invalid.");
  }
  return {
    maintenanceMode,
    version,
    updatedAt: setting.updated_at,
  };
}

async function verifyMaintenanceModeStorage(pool) {
  const setting = await readMaintenanceMode(pool);
  await pool.execute(
    `UPDATE site_maintenance_settings
     SET maintenance_mode = maintenance_mode
     WHERE id = 0`,
  );
  return setting;
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : "INTERNAL_ERROR";
}

module.exports = {
  readMaintenanceMode,
  safeErrorCode,
  verifyMaintenanceModeStorage,
};
