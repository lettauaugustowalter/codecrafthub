// app.js

const express = require("express");
const fs = require("fs/promises");
const path = require("path");

// Create the Express application
const app = express();

// The server will run on port 5000
const PORT = 5000;

// Store courses.json in the same folder as this file
const DATA_FILE = path.join(__dirname, "courses.json");

// These are the only valid course statuses
const VALID_STATUSES = [
  "Not Started",
  "In Progress",
  "Completed"
];

/*
  Custom error class.

  This allows us to attach an HTTP status code to errors, such as:
  - 400 for invalid user input
  - 404 when a course does not exist
  - 500 for file or server errors
*/
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

/*
  Middleware that allows Express to read JSON request bodies.

  Without this, req.body would be undefined when a client sends JSON.
*/
app.use(express.json());

/*
  Read all courses from courses.json.

  If the file does not exist, create it automatically with an
  empty array and return that empty array.
*/
async function readCourses() {
  try {
    const fileContents = await fs.readFile(DATA_FILE, "utf-8");

    // An empty file is treated as an empty course list
    if (!fileContents.trim()) {
      return [];
    }

    const courses = JSON.parse(fileContents);

    // Make sure the JSON file contains an array
    if (!Array.isArray(courses)) {
      throw new AppError(
        "courses.json must contain a JSON array",
        500
      );
    }

    return courses;
  } catch (error) {
    // If courses.json does not exist, create it automatically
    if (error.code === "ENOENT") {
      await writeCourses([]);
      return [];
    }

    // Re-throw our own errors unchanged
    if (error instanceof AppError) {
      throw error;
    }

    // JSON.parse errors usually mean the file contains invalid JSON
    if (error instanceof SyntaxError) {
      throw new AppError(
        "courses.json contains invalid JSON",
        500
      );
    }

    // Handle other file read errors
    throw new AppError(
      `Could not read courses.json: ${error.message}`,
      500
    );
  }
}

/*
  Save an array of courses to courses.json.

  JSON.stringify formats the file with indentation so it is easy
  for a beginner to read.
*/
async function writeCourses(courses) {
  try {
    const jsonData = JSON.stringify(courses, null, 2);

    await fs.writeFile(DATA_FILE, jsonData, "utf-8");
  } catch (error) {
    throw new AppError(
      `Could not write to courses.json: ${error.message}`,
      500
    );
  }
}

/*
  Check whether a value is missing or an empty string.
*/
function isMissing(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

/*
  Check that a date follows YYYY-MM-DD and represents a real date.

  For example:
  - 2026-12-31 is valid
  - 2026-02-30 is invalid
  - 12/31/2026 is invalid
*/
function isValidDate(dateString) {
  if (typeof dateString !== "string") {
    return false;
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!datePattern.test(dateString)) {
    return false;
  }

  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/*
  Check the fields required to create or replace a course.

  This function returns an array of error messages. An empty array
  means the course data is valid.
*/
function validateCourseData(courseData) {
  const errors = [];
  const {
    name,
    description,
    target_date,
    status
  } = courseData;

  if (isMissing(name)) {
    errors.push("name is required");
  }

  if (isMissing(description)) {
    errors.push("description is required");
  }

  if (isMissing(target_date)) {
    errors.push("target_date is required");
  } else if (!isValidDate(target_date)) {
    errors.push("target_date must use the format YYYY-MM-DD");
  }

  if (isMissing(status)) {
    errors.push("status is required");
  } else if (!VALID_STATUSES.includes(status)) {
    errors.push(
      `status must be one of: ${VALID_STATUSES.join(", ")}`
    );
  }

  return errors;
}

/*
  Find a course by its numeric ID.

  IDs are received as strings from the URL, so we convert the
  route parameter to a number before searching.
*/
function findCourseById(courses, id) {
  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId < 1) {
    return undefined;
  }

  return courses.find((course) => course.id === numericId);
}

/*
  GET /api/courses

  Return all courses.
*/
app.get("/api/courses", async (req, res, next) => {
  try {
    const courses = await readCourses();

    res.status(200).json(courses);
  } catch (error) {
    next(error);
  }
});

/*
  GET /api/courses/:id

  Return one specific course.
*/
app.get("/api/courses/:id", async (req, res, next) => {
  try {
    const courses = await readCourses();
    const course = findCourseById(courses, req.params.id);

    if (!course) {
      throw new AppError("Course not found", 404);
    }

    res.status(200).json(course);
  } catch (error) {
    next(error);
  }
});

/*
  POST /api/courses

  Create and save a new course.
*/
app.post("/api/courses", async (req, res, next) => {
  try {
    const validationErrors = validateCourseData(req.body);

    if (validationErrors.length > 0) {
      throw new AppError(
        "Invalid course data",
        400
      );
    }

    const courses = await readCourses();

    /*
      Generate the next ID.

      If there are no courses, the first ID is 1.
      Otherwise, find the highest existing ID and add 1.
    */
    const highestId = courses.reduce((highest, course) => {
      return Number.isInteger(course.id) && course.id > highest
        ? course.id
        : highest;
    }, 0);

    const newCourse = {
      id: highestId + 1,
      name: req.body.name.trim(),
      description: req.body.description.trim(),
      target_date: req.body.target_date,
      status: req.body.status,
      created_at: new Date().toISOString()
    };

    courses.push(newCourse);
    await writeCourses(courses);

    res.status(201).json(newCourse);
  } catch (error) {
    /*
      Add validation details to the response if the input is invalid.
    */
    if (error.statusCode === 400) {
      const validationErrors = validateCourseData(req.body);

      return res.status(400).json({
        error: error.message,
        details: validationErrors
      });
    }

    next(error);
  }
});

/*
  PUT /api/courses/:id

  Replace the editable fields of an existing course.

  The ID and created_at timestamp are preserved automatically.
*/
app.put("/api/courses/:id", async (req, res, next) => {
  try {
    const courses = await readCourses();
    const courseIndex = courses.findIndex(
      (course) => course.id === Number(req.params.id)
    );

    if (courseIndex === -1) {
      throw new AppError("Course not found", 404);
    }

    const validationErrors = validateCourseData(req.body);

    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "Invalid course data",
        details: validationErrors
      });
    }

    const existingCourse = courses[courseIndex];

    const updatedCourse = {
      id: existingCourse.id,
      name: req.body.name.trim(),
      description: req.body.description.trim(),
      target_date: req.body.target_date,
      status: req.body.status,
      created_at: existingCourse.created_at
    };

    courses[courseIndex] = updatedCourse;
    await writeCourses(courses);

    res.status(200).json(updatedCourse);
  } catch (error) {
    next(error);
  }
});

/*
  DELETE /api/courses/:id

  Delete a course by its ID.
*/
app.delete("/api/courses/:id", async (req, res, next) => {
  try {
    const courses = await readCourses();
    const courseIndex = courses.findIndex(
      (course) => course.id === Number(req.params.id)
    );

    if (courseIndex === -1) {
      throw new AppError("Course not found", 404);
    }

    courses.splice(courseIndex, 1);
    await writeCourses(courses);

    // 204 means the request succeeded with no response body
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/*
  Handle requests to routes that do not exist.
*/
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

/*
  Error-handling middleware.

  Express identifies error middleware because it has four parameters:
  err, req, res, next
*/
app.use((error, req, res, next) => {
  console.error(error);

  // Handle invalid JSON sent in a request body
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: "Request body contains invalid JSON"
    });
  }

  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    error:
      statusCode === 500
        ? "Internal server error"
        : error.message
  });
});

/*
  Create courses.json before starting the server.

  This means the file will exist automatically, even before the
  first course is created.
*/
async function startServer() {
  try {
    await fs.access(DATA_FILE);
    console.log("courses.json found");
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeCourses([]);
      console.log("courses.json created");
    } else {
      throw error;
    }
  }

  app.listen(PORT, () => {
    console.log(`CodeCraftHub API running at http://localhost:${PORT}`);
  });
}

// Start the application
startServer().catch((error) => {
  console.error("Could not start the server:", error.message);
  process.exit(1);
});