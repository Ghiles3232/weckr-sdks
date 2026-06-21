import type { ZodTypeAny } from 'zod';
import { z } from 'zod';

/**
 * Convert a Zod object schema to the minimal JSON Schema shape MCP clients
 * expect for tool inputs. We deliberately avoid the `zod-to-json-schema` npm
 * dependency to keep this package small and version-stable.
 *
 * Supported shapes (all that the tool inputs need today):
 *   - z.object({...}).strict()
 *   - z.string().min(n).max(n) / z.number().int().positive().max(n) / z.boolean()
 *   - z.enum([...])
 *   - .optional() / .describe('...')   ← describe() on the outer wrapper is honored
 */

interface JsonSchema {
  type?: string;
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
}

interface ZodCheck {
  kind: string;
  value?: number;
  inclusive?: boolean;
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema);
}

function convert(schema: ZodTypeAny): JsonSchema {
  // describe() is attached on the OUTER wrapper. Capture it before any unwrap.
  const outerDescription = (schema as unknown as { description?: string }).description;

  const def = (schema as unknown as { _def: { typeName?: string } })._def;
  const typeName = def?.typeName;

  switch (typeName) {
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        // Capture the OUTER description BEFORE unwrapping ZodOptional —
        // describe() on optional fields lives on the wrapper, not the inner.
        const childOuterDesc = (child as unknown as { description?: string }).description;
        const childDef = (child as unknown as { _def: { typeName?: string } })._def;
        const isOptional = childDef?.typeName === 'ZodOptional';
        const inner = isOptional
          ? (child as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType
          : child;
        const converted = convert(inner);
        if (childOuterDesc && !converted.description) converted.description = childOuterDesc;
        properties[key] = converted;
        if (!isOptional) required.push(key);
      }
      const out: JsonSchema = { type: 'object', properties, additionalProperties: false };
      if (required.length) out.required = required;
      if (outerDescription) out.description = outerDescription;
      return out;
    }
    case 'ZodString': {
      const checks = (schema as unknown as { _def: { checks?: ZodCheck[] } })._def.checks ?? [];
      const out: JsonSchema = { type: 'string' };
      for (const c of checks) {
        if (c.kind === 'min' && typeof c.value === 'number') out.minLength = c.value;
        if (c.kind === 'max' && typeof c.value === 'number') out.maxLength = c.value;
      }
      if (outerDescription) out.description = outerDescription;
      return out;
    }
    case 'ZodNumber': {
      const checks = (schema as unknown as { _def: { checks?: ZodCheck[] } })._def.checks ?? [];
      const isInt = checks.some((c) => c.kind === 'int');
      const out: JsonSchema = { type: isInt ? 'integer' : 'number' };
      for (const c of checks) {
        if (c.kind === 'min' && typeof c.value === 'number') {
          if (c.inclusive === false) out.exclusiveMinimum = c.value;
          else out.minimum = c.value;
        }
        if (c.kind === 'max' && typeof c.value === 'number') {
          if (c.inclusive === false) out.exclusiveMaximum = c.value;
          else out.maximum = c.value;
        }
      }
      if (outerDescription) out.description = outerDescription;
      return out;
    }
    case 'ZodBoolean': {
      const out: JsonSchema = { type: 'boolean' };
      if (outerDescription) out.description = outerDescription;
      return out;
    }
    case 'ZodEnum': {
      const values = (schema as unknown as { _def: { values: readonly string[] } })._def.values;
      const out: JsonSchema = { type: 'string', enum: values };
      if (outerDescription) out.description = outerDescription;
      return out;
    }
    case 'ZodOptional': {
      const inner = (schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType;
      const converted = convert(inner);
      if (outerDescription && !converted.description) converted.description = outerDescription;
      return converted;
    }
    default: {
      // Fallback: return an unconstrained object so clients can still try to call.
      // Keeps the server alive even if we add an unsupported shape by accident.
      const out: JsonSchema = { type: 'object' };
      if (outerDescription) out.description = outerDescription;
      return out;
    }
  }
}

// Re-export z to keep tools.ts imports tight.
export { z };
