// Generated from schema.orm. Do not edit.
import { createClient as createORMClient } from "../dist/index.js";
import type { Schema, ClientOptions, FieldUpdate, DecimalUpdate, Where, DateTime, DateTimeInput, JsonInput, Virtuals, WithVirtuals, GlobalOmit } from "../dist/index.js";
export type Preferences = {"theme":"light" | "dark"; "notifications":boolean; "languages":(string)[]};
export type UserRow = {
  "id": number;
  "email": string;
  "name": string | null;
};
export type UserCreate = { "email": string; "name"?: string | null; "id"?: never } & { "posts"?: AtLeastOne<{ create: DistributiveOmit<PostCreate, "authorId" | "author"> | (DistributiveOmit<PostCreate, "authorId" | "author">)[]; connect: PostUnique | PostUnique[]; connectOrCreate: { where: PostUnique; create: DistributiveOmit<PostCreate, "authorId" | "author"> } | { where: PostUnique; create: DistributiveOmit<PostCreate, "authorId" | "author"> }[]; createMany: { data: DistributiveOmit<PostScalarCreate, "authorId">[]; skipDuplicates?: boolean } }> } & { "profile"?: OneOf<{ create: DistributiveOmit<ProfileCreate, "userId" | "user">; connect: ProfileUnique; connectOrCreate: { where: ProfileUnique; create: DistributiveOmit<ProfileCreate, "userId" | "user"> } }> };
export type UserScalarUpdate = { "email"?: FieldUpdate<string>; "name"?: FieldUpdate<string | null> };
export type UserUpdate = UserScalarUpdate & {"posts"?: AtLeastOne<{update: {where:PostUnique;data:PostUpdate} | {where:PostUnique;data:PostUpdate}[]; delete: PostUnique | PostUnique[]; connect: PostUnique | PostUnique[]; create: DistributiveOmit<PostCreate, "authorId" | "author"> | (DistributiveOmit<PostCreate, "authorId" | "author">)[]; connectOrCreate: {where:PostUnique;create:DistributiveOmit<PostCreate, "authorId" | "author">} | {where:PostUnique;create:DistributiveOmit<PostCreate, "authorId" | "author">}[]; upsert: {where:PostUnique;create:DistributiveOmit<PostCreate, "authorId" | "author">;update:PostUpdate} | {where:PostUnique;create:DistributiveOmit<PostCreate, "authorId" | "author">;update:PostUpdate}[]; updateMany: {where?:Where<Models,"Post">;data:PostScalarUpdate} | {where?:Where<Models,"Post">;data:PostScalarUpdate}[]; deleteMany: Where<Models,"Post"> | Where<Models,"Post">[]; createMany: {data:DistributiveOmit<PostScalarCreate,"authorId">[];skipDuplicates?:boolean}; set: PostUnique[]}>; "profile"?: OneOf<{update: ProfileUpdate; delete: true; connect: ProfileUnique; create: DistributiveOmit<ProfileCreate, "userId" | "user">; connectOrCreate: {where:ProfileUnique;create:DistributiveOmit<ProfileCreate, "userId" | "user">}; upsert: {create:DistributiveOmit<ProfileCreate, "userId" | "user">;update:ProfileUpdate}}>};
export type UserScalarCreate = { "email": string; "name"?: string | null };
export type UserUnique = { "id": number } | { "email": string };
export type PostRow = {
  "id": number;
  "title": string;
  "published": boolean;
  "views": number;
  "createdAt": DateTime;
  "authorId": number;
  "reviewerId": number | null;
};
export type PostCreate = { "title": string; "published"?: boolean; "views"?: number; "createdAt"?: DateTimeInput; "id"?: never } & ({ "authorId": number; "author"?: never } | { "authorId"?: never; "author": OneOf<{ create: UserCreate; connect: UserUnique; connectOrCreate: { where: UserUnique; create: UserCreate } }> }) & ({ "reviewerId"?: number | null; "reviewer"?: never } | { "reviewerId"?: never; "reviewer": OneOf<{ create: UserCreate; connect: UserUnique; connectOrCreate: { where: UserUnique; create: UserCreate } }> }) & { "tags"?: AtLeastOne<{ create: TagCreate | (TagCreate)[]; connect: TagUnique | TagUnique[]; connectOrCreate: { where: TagUnique; create: TagCreate } | { where: TagUnique; create: TagCreate }[] }> };
export type PostScalarUpdate = { "title"?: FieldUpdate<string>; "published"?: FieldUpdate<boolean>; "views"?: FieldUpdate<number>; "createdAt"?: FieldUpdate<DateTimeInput>; "authorId"?: FieldUpdate<number>; "reviewerId"?: FieldUpdate<number | null> };
export type PostUpdate = PostScalarUpdate & {"author"?: OneOf<{update: UserUpdate; delete: true; connect: UserUnique; create: UserCreate; connectOrCreate: {where:UserUnique;create:UserCreate}; upsert: {create:UserCreate;update:UserUpdate}}>; "reviewer"?: OneOf<{update: UserUpdate; delete: true; connect: UserUnique; create: UserCreate; connectOrCreate: {where:UserUnique;create:UserCreate}; upsert: {create:UserCreate;update:UserUpdate}; disconnect: true}>; "tags"?: AtLeastOne<{update: {where:TagUnique;data:TagUpdate} | {where:TagUnique;data:TagUpdate}[]; delete: TagUnique | TagUnique[]; connect: TagUnique | TagUnique[]; create: TagCreate | (TagCreate)[]; connectOrCreate: {where:TagUnique;create:TagCreate} | {where:TagUnique;create:TagCreate}[]; upsert: {where:TagUnique;create:TagCreate;update:TagUpdate} | {where:TagUnique;create:TagCreate;update:TagUpdate}[]; updateMany: {where?:Where<Models,"Tag">;data:TagScalarUpdate} | {where?:Where<Models,"Tag">;data:TagScalarUpdate}[]; deleteMany: Where<Models,"Tag"> | Where<Models,"Tag">[]; disconnect: TagUnique | TagUnique[]; set: TagUnique[]}>};
export type PostScalarCreate = { "title": string; "published"?: boolean; "views"?: number; "createdAt"?: DateTimeInput; "authorId": number; "reviewerId"?: number | null };
export type PostUnique = { "id": number };
export type ProfileRow = {
  "id": number;
  "bio": string;
  "userId": number;
};
export type ProfileCreate = { "bio"?: string; "id"?: never } & ({ "userId": number; "user"?: never } | { "userId"?: never; "user": OneOf<{ create: UserCreate; connect: UserUnique; connectOrCreate: { where: UserUnique; create: UserCreate } }> });
export type ProfileScalarUpdate = { "bio"?: FieldUpdate<string>; "userId"?: FieldUpdate<number> };
export type ProfileUpdate = ProfileScalarUpdate & {"user"?: OneOf<{update: UserUpdate; delete: true; connect: UserUnique; create: UserCreate; connectOrCreate: {where:UserUnique;create:UserCreate}; upsert: {create:UserCreate;update:UserUpdate}}>};
export type ProfileScalarCreate = { "bio"?: string; "userId": number };
export type ProfileUnique = { "id": number } | { "userId": number };
export type TagRow = {
  "id": number;
  "name": string;
};
export type TagCreate = { "name": string; "id"?: never } & { "posts"?: AtLeastOne<{ create: PostCreate | (PostCreate)[]; connect: PostUnique | PostUnique[]; connectOrCreate: { where: PostUnique; create: PostCreate } | { where: PostUnique; create: PostCreate }[] }> };
export type TagScalarUpdate = { "name"?: FieldUpdate<string> };
export type TagUpdate = TagScalarUpdate & {"posts"?: AtLeastOne<{update: {where:PostUnique;data:PostUpdate} | {where:PostUnique;data:PostUpdate}[]; delete: PostUnique | PostUnique[]; connect: PostUnique | PostUnique[]; create: PostCreate | (PostCreate)[]; connectOrCreate: {where:PostUnique;create:PostCreate} | {where:PostUnique;create:PostCreate}[]; upsert: {where:PostUnique;create:PostCreate;update:PostUpdate} | {where:PostUnique;create:PostCreate;update:PostUpdate}[]; updateMany: {where?:Where<Models,"Post">;data:PostScalarUpdate} | {where?:Where<Models,"Post">;data:PostScalarUpdate}[]; deleteMany: Where<Models,"Post"> | Where<Models,"Post">[]; disconnect: PostUnique | PostUnique[]; set: PostUnique[]}>};
export type TagScalarCreate = { "name": string };
export type TagUnique = { "id": number } | { "name": string };
export type AccountRow = {
  "id": number;
  "email": string;
  "name": string | null;
  "preferences": Preferences | null;
  "deletedAt": DateTime | null;
};
export type AccountCreate = { "email": string; "name"?: string | null; "preferences"?: JsonInput<Preferences,true> | null; "id"?: never } & { "entries"?: AtLeastOne<{ create: DistributiveOmit<AccountEntryCreate, "accountId" | "account"> | (DistributiveOmit<AccountEntryCreate, "accountId" | "account">)[]; connect: AccountEntryUnique | AccountEntryUnique[]; connectOrCreate: { where: AccountEntryUnique; create: DistributiveOmit<AccountEntryCreate, "accountId" | "account"> } | { where: AccountEntryUnique; create: DistributiveOmit<AccountEntryCreate, "accountId" | "account"> }[]; createMany: { data: DistributiveOmit<AccountEntryScalarCreate, "accountId">[]; skipDuplicates?: boolean } }> };
export type AccountScalarUpdate = { "email"?: FieldUpdate<string>; "name"?: FieldUpdate<string | null>; "preferences"?: FieldUpdate<JsonInput<Preferences,true> | null> };
export type AccountUpdate = AccountScalarUpdate & {"entries"?: AtLeastOne<{update: {where:AccountEntryUnique;data:AccountEntryUpdate} | {where:AccountEntryUnique;data:AccountEntryUpdate}[]; delete: AccountEntryUnique | AccountEntryUnique[]; connect: AccountEntryUnique | AccountEntryUnique[]; create: DistributiveOmit<AccountEntryCreate, "accountId" | "account"> | (DistributiveOmit<AccountEntryCreate, "accountId" | "account">)[]; connectOrCreate: {where:AccountEntryUnique;create:DistributiveOmit<AccountEntryCreate, "accountId" | "account">} | {where:AccountEntryUnique;create:DistributiveOmit<AccountEntryCreate, "accountId" | "account">}[]; upsert: {where:AccountEntryUnique;create:DistributiveOmit<AccountEntryCreate, "accountId" | "account">;update:AccountEntryUpdate} | {where:AccountEntryUnique;create:DistributiveOmit<AccountEntryCreate, "accountId" | "account">;update:AccountEntryUpdate}[]; updateMany: {where?:Where<Models,"AccountEntry">;data:AccountEntryScalarUpdate} | {where?:Where<Models,"AccountEntry">;data:AccountEntryScalarUpdate}[]; deleteMany: Where<Models,"AccountEntry"> | Where<Models,"AccountEntry">[]; createMany: {data:DistributiveOmit<AccountEntryScalarCreate,"accountId">[];skipDuplicates?:boolean}; set: AccountEntryUnique[]}>};
export type AccountScalarCreate = { "email": string; "name"?: string | null; "preferences"?: JsonInput<Preferences,true> | null };
export type AccountUnique = { "id": number } | { "email": string };
export type AccountEntryRow = {
  "id": number;
  "title": string;
  "deletedAt": DateTime | null;
  "accountId": number;
};
export type AccountEntryCreate = { "title": string; "id"?: never } & ({ "accountId": number; "account"?: never } | { "accountId"?: never; "account": OneOf<{ create: AccountCreate; connect: AccountUnique; connectOrCreate: { where: AccountUnique; create: AccountCreate } }> });
export type AccountEntryScalarUpdate = { "title"?: FieldUpdate<string>; "accountId"?: FieldUpdate<number> };
export type AccountEntryUpdate = AccountEntryScalarUpdate & {"account"?: OneOf<{update: AccountUpdate; delete: true; connect: AccountUnique; create: AccountCreate; connectOrCreate: {where:AccountUnique;create:AccountCreate}; upsert: {create:AccountCreate;update:AccountUpdate}}>};
export type AccountEntryScalarCreate = { "title": string; "accountId": number };
export type AccountEntryUnique = { "id": number };
type AtLeastOne<T> = {[K in keyof T]:Required<Pick<T,K>> & Partial<Omit<T,K>>}[keyof T];
type OneOf<T> = {[K in keyof T]:{[P in K]:T[P]} & {[P in Exclude<keyof T,K>]?:never}}[keyof T];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Models = {
"User": { row: UserRow; create: UserCreate; update: UserUpdate; dateFields:never; jsonFields:never; scalarCreate:UserScalarCreate; scalarUpdate:UserScalarUpdate; unique: UserUnique; relations: { "posts": { target: "Post"; many: true; nullable: false }; "profile": { target: "Profile"; many: false; nullable: true } } };
"Post": { row: PostRow; create: PostCreate; update: PostUpdate; dateFields:"createdAt"; jsonFields:never; scalarCreate:PostScalarCreate; scalarUpdate:PostScalarUpdate; unique: PostUnique; relations: { "author": { target: "User"; many: false; nullable: false }; "reviewer": { target: "User"; many: false; nullable: true }; "tags": { target: "Tag"; many: true; nullable: false } } };
"Profile": { row: ProfileRow; create: ProfileCreate; update: ProfileUpdate; dateFields:never; jsonFields:never; scalarCreate:ProfileScalarCreate; scalarUpdate:ProfileScalarUpdate; unique: ProfileUnique; relations: { "user": { target: "User"; many: false; nullable: false } } };
"Tag": { row: TagRow; create: TagCreate; update: TagUpdate; dateFields:never; jsonFields:never; scalarCreate:TagScalarCreate; scalarUpdate:TagScalarUpdate; unique: TagUnique; relations: { "posts": { target: "Post"; many: true; nullable: false } } };
"Account": { row: AccountRow; create: AccountCreate; update: AccountUpdate; dateFields:"deletedAt"; jsonFields:"preferences"; scalarCreate:AccountScalarCreate; scalarUpdate:AccountScalarUpdate; unique: AccountUnique; relations: { "entries": { target: "AccountEntry"; many: true; nullable: false } } };
"AccountEntry": { row: AccountEntryRow; create: AccountEntryCreate; update: AccountEntryUpdate; dateFields:"deletedAt"; jsonFields:never; scalarCreate:AccountEntryScalarCreate; scalarUpdate:AccountEntryScalarUpdate; unique: AccountEntryUnique; relations: { "account": { target: "Account"; many: false; nullable: false } } };
};
export const schema: Schema = {
  "version": 1,
  "tables": {
    "User": {
      "name": "User",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "email": {
          "name": "email",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": true,
          "maxLength": 191
        },
        "name": {
          "name": "name",
          "type": "string",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
        }
      },
      "relations": {
        "posts": {
          "name": "posts",
          "target": "Post",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "authorId"
        },
        "profile": {
          "name": "profile",
          "target": "Profile",
          "many": false,
          "nullable": true,
          "owner": false,
          "source": "id",
          "foreign": "userId"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": []
    },
    "Post": {
      "name": "Post",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "title": {
          "name": "title",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        },
        "published": {
          "name": "published",
          "type": "boolean",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": false
        },
        "views": {
          "name": "views",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": 0
        },
        "createdAt": {
          "name": "createdAt",
          "type": "date",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": {
            "fn": "now"
          }
        },
        "authorId": {
          "name": "authorId",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        },
        "reviewerId": {
          "name": "reviewerId",
          "type": "int",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
        }
      },
      "relations": {
        "author": {
          "name": "author",
          "target": "User",
          "many": false,
          "nullable": false,
          "owner": true,
          "source": "authorId",
          "foreign": "id"
        },
        "reviewer": {
          "name": "reviewer",
          "target": "User",
          "many": false,
          "nullable": true,
          "owner": true,
          "source": "reviewerId",
          "foreign": "id"
        },
        "tags": {
          "name": "tags",
          "target": "Tag",
          "many": true,
          "nullable": false,
          "owner": true,
          "source": "id",
          "foreign": "id",
          "junction": "_Post_tags",
          "junctionSource": "sourceId",
          "junctionTarget": "targetId"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": []
    },
    "Profile": {
      "name": "Profile",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "bio": {
          "name": "bio",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": ""
        },
        "userId": {
          "name": "userId",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": true
        }
      },
      "relations": {
        "user": {
          "name": "user",
          "target": "User",
          "many": false,
          "nullable": false,
          "owner": true,
          "source": "userId",
          "foreign": "id"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": []
    },
    "Tag": {
      "name": "Tag",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "name": {
          "name": "name",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": true,
          "maxLength": 191
        }
      },
      "relations": {
        "posts": {
          "name": "posts",
          "target": "Post",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "id",
          "junction": "_Post_tags",
          "junctionSource": "targetId",
          "junctionTarget": "sourceId"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": []
    },
    "Account": {
      "name": "Account",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "email": {
          "name": "email",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": true,
          "maxLength": 191
        },
        "name": {
          "name": "name",
          "type": "string",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
        },
        "preferences": {
          "name": "preferences",
          "type": "json",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "json": {
            "root": {
              "kind": "ref",
              "name": "Preferences"
            },
            "definitions": {
              "Preferences": {
                "kind": "object",
                "fields": {
                  "theme": {
                    "optional": false,
                    "shape": {
                      "kind": "union",
                      "items": [
                        {
                          "kind": "literal",
                          "value": "light"
                        },
                        {
                          "kind": "literal",
                          "value": "dark"
                        }
                      ]
                    }
                  },
                  "notifications": {
                    "optional": false,
                    "shape": {
                      "kind": "primitive",
                      "name": "boolean"
                    }
                  },
                  "languages": {
                    "optional": false,
                    "shape": {
                      "kind": "array",
                      "element": {
                        "kind": "primitive",
                        "name": "string"
                      }
                    }
                  }
                }
              }
            }
          },
          "default": null
        },
        "deletedAt": {
          "name": "deletedAt",
          "type": "date",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
        }
      },
      "relations": {
        "entries": {
          "name": "entries",
          "target": "AccountEntry",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "accountId"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": [],
      "softDelete": "deletedAt"
    },
    "AccountEntry": {
      "name": "AccountEntry",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "title": {
          "name": "title",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        },
        "deletedAt": {
          "name": "deletedAt",
          "type": "date",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
        },
        "accountId": {
          "name": "accountId",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        }
      },
      "relations": {
        "account": {
          "name": "account",
          "target": "Account",
          "many": false,
          "nullable": false,
          "owner": true,
          "source": "accountId",
          "foreign": "id"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": [],
      "softDelete": "deletedAt"
    }
  },
  "jsonTypes": {
    "Preferences": {
      "kind": "object",
      "fields": {
        "theme": {
          "optional": false,
          "shape": {
            "kind": "union",
            "items": [
              {
                "kind": "literal",
                "value": "light"
              },
              {
                "kind": "literal",
                "value": "dark"
              }
            ]
          }
        },
        "notifications": {
          "optional": false,
          "shape": {
            "kind": "primitive",
            "name": "boolean"
          }
        },
        "languages": {
          "optional": false,
          "shape": {
            "kind": "array",
            "element": {
              "kind": "primitive",
              "name": "string"
            }
          }
        }
      }
    }
  }
};
export const createClient = <const V extends Virtuals<Models> = {}, const O extends GlobalOmit<WithVirtuals<Models,V>> = {}>(options: ClientOptions<Models,V,O>) => createORMClient<Models,V,O>(schema, options);
