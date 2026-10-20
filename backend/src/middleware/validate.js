function validate(schema, property = "body") {
  return (request, response, next) => {
    const result = schema.safeParse(request[property]);

    if (!result.success) {
      return response.status(400).json({
        error: "Invalid request data",
        issues: result.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    }

    request[property] = result.data;
    return next();
  };
}

module.exports = { validate };
