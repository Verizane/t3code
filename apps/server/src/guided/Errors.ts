import { Schema } from "effect";

export class GuidedThreadServiceError extends Schema.TaggedErrorClass<GuidedThreadServiceError>()(
  "GuidedThreadServiceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
