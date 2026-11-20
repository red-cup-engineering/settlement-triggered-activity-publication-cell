import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";

const ROOT = new URL("../content/schemas/", import.meta.url);

function validator(name) {
  const schema = JSON.parse(readFileSync(new URL(name, ROOT), "utf8"));
  return new Validator(schema, "2020-12", false);
}

const validators = Object.freeze({
  input: validator("input.schema.json"),
  output: validator("output.schema.json"),
  refusal: validator("refusal.schema.json"),
  state: validator("state.schema.json"),
});

function assertContract(kind, value) {
  const result = validators[kind].validate(value);
  if (!result.valid) {
    const detail = result.errors.map(({ error }) => error).join("; ");
    throw new TypeError(`${kind} contract refused: ${detail}`);
  }
  return value;
}

export const assertInput = (value) => assertContract("input", value);
export const assertOutput = (value) => assertContract("output", value);
export const assertRefusal = (value) => assertContract("refusal", value);
export const assertState = (value) => assertContract("state", value);
