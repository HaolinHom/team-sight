import { z } from 'zod';
export declare const tapdId: z.ZodString;
export declare const dateKey: z.ZodString;
export declare const entityType: z.ZodEnum<{
    task: "task";
    bug: "bug";
    story: "story";
}>;
export declare const workspaceInput: z.ZodObject<{
    workspaceId: z.ZodString;
}, z.core.$strict>;
export declare const schemaInput: z.ZodObject<{
    workspaceId: z.ZodString;
    entityType: z.ZodEnum<{
        task: "task";
        story: "story";
    }>;
    workitemTypeId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const searchInput: z.ZodObject<{
    workspaceId: z.ZodString;
    entityType: z.ZodEnum<{
        task: "task";
        bug: "bug";
        story: "story";
    }>;
    keyword: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodString>;
    owner: z.ZodOptional<z.ZodString>;
    storyId: z.ZodOptional<z.ZodString>;
    range: z.ZodOptional<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
    }, z.core.$strict>>;
    modified: z.ZodOptional<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
    }, z.core.$strict>>;
    limit: z.ZodOptional<z.ZodNumber>;
    page: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const getItemInput: z.ZodObject<{
    workspaceId: z.ZodString;
    entityType: z.ZodEnum<{
        task: "task";
        bug: "bug";
        story: "story";
    }>;
    id: z.ZodString;
}, z.core.$strict>;
export declare const writeFields: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    owner: z.ZodOptional<z.ZodString>;
    begin: z.ZodOptional<z.ZodString>;
    due: z.ZodOptional<z.ZodString>;
    effort: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodString>;
    story_id: z.ZodOptional<z.ZodString>;
    iteration_id: z.ZodOptional<z.ZodString>;
    workitem_type_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const createItemInput: z.ZodObject<{
    workspaceId: z.ZodString;
    entityType: z.ZodEnum<{
        task: "task";
        story: "story";
    }>;
    fields: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        owner: z.ZodOptional<z.ZodString>;
        begin: z.ZodOptional<z.ZodString>;
        due: z.ZodOptional<z.ZodString>;
        effort: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        story_id: z.ZodOptional<z.ZodString>;
        iteration_id: z.ZodOptional<z.ZodString>;
        workitem_type_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    idempotencyKey: z.ZodString;
    actor: z.ZodString;
}, z.core.$strict>;
export declare const updateItemInput: z.ZodObject<{
    workspaceId: z.ZodString;
    entityType: z.ZodEnum<{
        task: "task";
        story: "story";
    }>;
    fields: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        owner: z.ZodOptional<z.ZodString>;
        begin: z.ZodOptional<z.ZodString>;
        due: z.ZodOptional<z.ZodString>;
        effort: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        story_id: z.ZodOptional<z.ZodString>;
        iteration_id: z.ZodOptional<z.ZodString>;
        workitem_type_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    idempotencyKey: z.ZodString;
    actor: z.ZodString;
    id: z.ZodString;
    expectedDigest: z.ZodString;
}, z.core.$strict>;
export declare const timesheetsInput: z.ZodObject<{
    workspaceId: z.ZodString;
    start: z.ZodString;
    end: z.ZodString;
    entityType: z.ZodOptional<z.ZodEnum<{
        task: "task";
        bug: "bug";
    }>>;
    entityId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Both the catalog JSON Schema and generic-call validation come from these schemas. */
export declare function operationInput(id: string): z.ZodObject<{}, z.core.$strict>;
export declare const operationJsonSchema: (id: string) => z.core.ZodStandardJSONSchemaPayload<z.ZodObject<{}, z.core.$strict>>;
