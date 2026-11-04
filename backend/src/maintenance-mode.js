async function readMaintenanceMode(pool) {
  const [rows] = await pool.execute("SELECT setting_value, updated_at FROM site_settings WHERE setting_key = 'maintenance_mode' LIMIT 1");
  if (!rows[0] || !["0", "1"].includes(String(rows[0].setting_value))) throw new Error("The maintenance setting is missing or invalid.");
  return { maintenanceMode: String(rows[0].setting_value) === "1", updatedAt: rows[0].updated_at };
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : "INTERNAL_ERROR";
}

module.exports = { readMaintenanceMode, safeErrorCode };
