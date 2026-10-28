// A fixed setup for the tests, so they don't depend on what public/setup.js says.
import { configure, TYPES } from "../public/model.js";

export const TEST_SETUP = {
  timeZone: "America/Los_Angeles",
  types: TYPES,
  exercises: {
    Push: ["Dumbbell Bench Press", "Incline Dumbbell Bench Press", "Seated Bench Press", "Overhead Press", "Cable Fly",
      "Dumbbell Fly", "Lateral Raise", "Tricep Pushdown", "Abdominal Crunch", "Abdominal Twist"],
    Pull: ["Lat Pulldown", "Seated Row", "Dumbbell Row", "Face Pull", "Rope Curl", "Seated Curl"],
    Legs: ["Leg Press", "Bulgarian Split Squat", "Seated Leg Curl", "Calf Raise", "Hip Abduction", "Goblet Squat", "Kettlebell Swing"],
    Other: [],
  },
  spots: ["Home break"],
  activities: ["Yoga", "Running", "Kettlebell Circuit", "Kitesurfing", "Swimming", "Golf"],
};

configure(TEST_SETUP);
