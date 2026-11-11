// Generated from schema.orm. Do not edit.
import { createClient as createORMClient } from "@ofis/tsorm";
import type { Schema, ClientOptions, FieldUpdate, DecimalUpdate, Where, DateTime, DateTimeInput, JsonInput, Invalid } from "@ofis/tsorm";
export type Preferences = {"theme":"light" | "dark"; "notifications":boolean; "languages":(string)[]};
export type UserRow = {
  "id": number;
  "email": string;
  "name": string | null;
  "role": "admin" | "member";
  "createdAt": DateTime;
  "updatedAt": DateTime;
};
export type UserCreate = { "email": string; "name"?: string | null; "role"?: "admin" | "member"; "createdAt"?: DateTimeInput; "updatedAt"?: DateTimeInput; "id"?: never } & { "following"?: UserCreateFollowingInput; "posts"?: UserCreatePostsInput; "profile"?: UserCreateProfileInput; "followers"?: UserCreateFollowersInput; "attachments"?: UserCreateAttachmentsInput };
export type UserScalarUpdate = { "email"?: FieldUpdate<string>; "name"?: FieldUpdate<string | null>; "role"?: FieldUpdate<"admin" | "member">; "createdAt"?: FieldUpdate<DateTimeInput>; "updatedAt"?: FieldUpdate<DateTimeInput> };
export type UserUpdate = UserScalarUpdate & { "following"?: UserUpdateFollowingInput; "posts"?: UserUpdatePostsInput; "profile"?: UserUpdateProfileInput; "followers"?: UserUpdateFollowersInput; "attachments"?: UserUpdateAttachmentsInput };
export type UserScalarCreate = { "id"?: never; "email": string; "name"?: string | null; "role"?: "admin" | "member"; "createdAt"?: DateTimeInput; "updatedAt"?: DateTimeInput };
export type UserUnique = { "id": number } | { "email": string };
export type PostRow = {
  "id": number;
  "title": string;
  "body": string | null;
  "published": boolean;
  "views": number;
  "authorId": number;
};
export type PostCreate = { "title": string; "body"?: string | null; "published"?: boolean; "views"?: number; "id"?: never } & ({ "authorId"?: Invalid<"Use either authorId or author, not both">; "author": PostCreateAuthorInput } | { "authorId": number; "author"?: Invalid<"Use either authorId or author, not both"> }) & { "tags"?: PostCreateTagsInput; "attachments"?: PostCreateAttachmentsInput; "notes"?: PostCreateNotesInput };
export type PostScalarUpdate = { "title"?: FieldUpdate<string>; "body"?: FieldUpdate<string | null>; "published"?: FieldUpdate<boolean>; "views"?: FieldUpdate<number>; "authorId"?: FieldUpdate<number> };
export type PostUpdate = PostScalarUpdate & { "author"?: PostUpdateAuthorInput; "tags"?: PostUpdateTagsInput; "attachments"?: PostUpdateAttachmentsInput; "notes"?: PostUpdateNotesInput };
export type PostScalarCreate = { "id"?: never; "title": string; "body"?: string | null; "published"?: boolean; "views"?: number; "authorId": number };
export type PostUnique = { "id": number };
export type ProfileRow = {
  "id": number;
  "bio": string;
  "userId": number;
};
export type ProfileCreate = { "bio"?: string; "id"?: never } & ({ "userId"?: Invalid<"Use either userId or user, not both">; "user": ProfileCreateUserInput } | { "userId": number; "user"?: Invalid<"Use either userId or user, not both"> });
export type ProfileScalarUpdate = { "bio"?: FieldUpdate<string>; "userId"?: FieldUpdate<number> };
export type ProfileUpdate = ProfileScalarUpdate & { "user"?: ProfileUpdateUserInput };
export type ProfileScalarCreate = { "id"?: never; "bio"?: string; "userId": number };
export type ProfileUnique = { "id": number } | { "userId": number };
export type TagRow = {
  "id": number;
  "name": string;
};
export type TagCreate = { "name": string; "id"?: never };
export type TagScalarUpdate = { "name"?: FieldUpdate<string> };
export type TagUpdate = TagScalarUpdate;
export type TagScalarCreate = { "id"?: never; "name": string };
export type TagUnique = { "id": number } | { "name": string };
export type CategoryRow = {
  "id": number;
  "name": string;
  "parentId": number | null;
};
export type CategoryCreate = { "name": string; "id"?: never } & ({ "parentId"?: Invalid<"Use either parentId or parent, not both">; "parent": CategoryCreateParentInput } | { "parentId"?: number | null; "parent"?: Invalid<"Use either parentId or parent, not both"> }) & { "children"?: CategoryCreateChildrenInput };
export type CategoryScalarUpdate = { "name"?: FieldUpdate<string>; "parentId"?: FieldUpdate<number | null> };
export type CategoryUpdate = CategoryScalarUpdate & { "parent"?: CategoryUpdateParentInput; "children"?: CategoryUpdateChildrenInput };
export type CategoryScalarCreate = { "id"?: never; "name": string; "parentId"?: number | null };
export type CategoryUnique = { "id": number };
export type SlotRow = {
  "id": number;
  "owner": string;
  "slot": number;
};
export type SlotCreate = { "owner": string; "slot": number; "id"?: never };
export type SlotScalarUpdate = { "owner"?: FieldUpdate<string>; "slot"?: FieldUpdate<number> };
export type SlotUpdate = SlotScalarUpdate;
export type SlotScalarCreate = { "id"?: never; "owner": string; "slot": number };
export type SlotUnique = { "id": number } | { "owner": string; "slot": number };
export type ProductRow = {
  "id": string;
  "sku": string;
  "price": string;
  "stock": string;
  "payload": Uint8Array | null;
};
export type ProductCreate = { "id"?: string; "sku": string; "price": string | number; "stock"?: bigint | string | number; "payload"?: Uint8Array | null };
export type ProductScalarUpdate = { "sku"?: FieldUpdate<string>; "price"?: DecimalUpdate<string | number>; "stock"?: FieldUpdate<bigint | string | number>; "payload"?: FieldUpdate<Uint8Array | null> };
export type ProductUpdate = ProductScalarUpdate;
export type ProductScalarCreate = { "id"?: string; "sku": string; "price": string | number; "stock"?: bigint | string | number; "payload"?: Uint8Array | null };
export type ProductUnique = { "id": string } | { "sku": string };
export type AccountRow = {
  "id": number;
  "email": string;
  "preferences": Preferences | null;
  "deletedAt": DateTime | null;
};
export type AccountCreate = { "email": string; "preferences"?: JsonInput<Preferences,true> | null; "id"?: never } & { "entries"?: AccountCreateEntriesInput };
export type AccountScalarUpdate = { "email"?: FieldUpdate<string>; "preferences"?: FieldUpdate<JsonInput<Preferences,true> | null> };
export type AccountUpdate = AccountScalarUpdate & { "entries"?: AccountUpdateEntriesInput };
export type AccountScalarCreate = { "id"?: never; "email": string; "preferences"?: JsonInput<Preferences,true> | null; "deletedAt"?: never };
export type AccountUnique = { "id": number } | { "email": string };
export type AccountEntryRow = {
  "id": number;
  "title": string;
  "deletedAt": DateTime | null;
  "accountId": number;
};
export type AccountEntryCreate = { "title": string; "id"?: never } & ({ "accountId"?: Invalid<"Use either accountId or account, not both">; "account": AccountEntryCreateAccountInput } | { "accountId": number; "account"?: Invalid<"Use either accountId or account, not both"> });
export type AccountEntryScalarUpdate = { "title"?: FieldUpdate<string>; "accountId"?: FieldUpdate<number> };
export type AccountEntryUpdate = AccountEntryScalarUpdate & { "account"?: AccountEntryUpdateAccountInput };
export type AccountEntryScalarCreate = { "id"?: never; "title": string; "deletedAt"?: never; "accountId": number };
export type AccountEntryUnique = { "id": number };
export type AttachmentRow = {
  "id": number;
  "name": string;
  "ownerType": "Post" | "User";
  "ownerId": number;
};
export type AttachmentCreate = { "name": string; "ownerType": "Post" | "User"; "ownerId": number; "id"?: never };
export type AttachmentScalarUpdate = { "name"?: FieldUpdate<string>; "ownerType"?: FieldUpdate<"Post" | "User">; "ownerId"?: FieldUpdate<number> };
export type AttachmentUpdate = AttachmentScalarUpdate;
export type AttachmentScalarCreate = { "id"?: never; "name": string; "ownerType": "Post" | "User"; "ownerId": number };
export type AttachmentUnique = { "id": number };
export type NoteRow = {
  "id": number;
  "body": string;
  "holderType": string;
  "holderId": number;
};
export type NoteCreate = { "body": string; "holderType": string; "holderId": number; "id"?: never };
export type NoteScalarUpdate = { "body"?: FieldUpdate<string>; "holderType"?: FieldUpdate<string>; "holderId"?: FieldUpdate<number> };
export type NoteUpdate = NoteScalarUpdate;
export type NoteScalarCreate = { "id"?: never; "body": string; "holderType": string; "holderId": number };
export type NoteUnique = { "id": number };
export type UserCreateFollowingInput = AtLeastOne<{ create: UserCreate | (UserCreate)[]; connect: UserUnique | UserUnique[]; connectOrCreate: { where: UserUnique; create: UserCreate } | { where: UserUnique; create: UserCreate }[] }>;
export type PostCreateWithoutAuthor = DistributiveOmit<PostCreate, "authorId" | "author">;
export type UserCreatePostsInput = AtLeastOne<{ create: PostCreateWithoutAuthor | (PostCreateWithoutAuthor)[]; connect: PostUnique | PostUnique[]; connectOrCreate: { where: PostUnique; create: PostCreateWithoutAuthor } | { where: PostUnique; create: PostCreateWithoutAuthor }[]; createMany: { data: DistributiveOmit<PostScalarCreate, "authorId">[]; skipDuplicates?: boolean } }>;
export type ProfileCreateWithoutUser = DistributiveOmit<ProfileCreate, "userId" | "user">;
export type UserCreateProfileInput = OneOf<{ create: ProfileCreateWithoutUser; connect: ProfileUnique; connectOrCreate: { where: ProfileUnique; create: ProfileCreateWithoutUser } }>;
export type UserCreateFollowersInput = AtLeastOne<{ create: UserCreate | (UserCreate)[]; connect: UserUnique | UserUnique[]; connectOrCreate: { where: UserUnique; create: UserCreate } | { where: UserUnique; create: UserCreate }[] }>;
export type AttachmentCreateWithoutAttachments = DistributiveOmit<AttachmentCreate, "ownerId" | "ownerType">;
export type UserCreateAttachmentsInput = AtLeastOne<{ create: AttachmentCreateWithoutAttachments | (AttachmentCreateWithoutAttachments)[]; createMany: { data: DistributiveOmit<AttachmentScalarCreate, "ownerId" | "ownerType">[]; skipDuplicates?: boolean } }>;
export type UserUpdateFollowingInput = AtLeastOne<{ update: {where:UserUnique;data:UserUpdate} | {where:UserUnique;data:UserUpdate}[]; delete: UserUnique | UserUnique[]; connect: UserUnique | UserUnique[]; create: UserCreate | (UserCreate)[]; connectOrCreate: {where:UserUnique;create:UserCreate} | {where:UserUnique;create:UserCreate}[]; upsert: {where:UserUnique;create:UserCreate;update:UserUpdate} | {where:UserUnique;create:UserCreate;update:UserUpdate}[]; updateMany: {where?:Where<Models,"User">;data:UserScalarUpdate} | {where?:Where<Models,"User">;data:UserScalarUpdate}[]; deleteMany: Where<Models,"User"> | Where<Models,"User">[]; disconnect: UserUnique | UserUnique[]; set: UserUnique[] }>;
export type UserUpdatePostsInput = AtLeastOne<{ update: {where:PostUnique;data:PostUpdate} | {where:PostUnique;data:PostUpdate}[]; delete: PostUnique | PostUnique[]; connect: PostUnique | PostUnique[]; create: PostCreateWithoutAuthor | (PostCreateWithoutAuthor)[]; connectOrCreate: {where:PostUnique;create:PostCreateWithoutAuthor} | {where:PostUnique;create:PostCreateWithoutAuthor}[]; upsert: {where:PostUnique;create:PostCreateWithoutAuthor;update:PostUpdate} | {where:PostUnique;create:PostCreateWithoutAuthor;update:PostUpdate}[]; updateMany: {where?:Where<Models,"Post">;data:PostScalarUpdate} | {where?:Where<Models,"Post">;data:PostScalarUpdate}[]; deleteMany: Where<Models,"Post"> | Where<Models,"Post">[]; createMany: {data:DistributiveOmit<PostScalarCreate,"authorId">[];skipDuplicates?:boolean}; set: PostUnique[] }>;
export type UserUpdateProfileInput = OneOf<{ update: ProfileUpdate; delete: true; connect: ProfileUnique; create: ProfileCreateWithoutUser; connectOrCreate: {where:ProfileUnique;create:ProfileCreateWithoutUser}; upsert: {create:ProfileCreateWithoutUser;update:ProfileUpdate} }>;
export type UserUpdateFollowersInput = AtLeastOne<{ update: {where:UserUnique;data:UserUpdate} | {where:UserUnique;data:UserUpdate}[]; delete: UserUnique | UserUnique[]; connect: UserUnique | UserUnique[]; create: UserCreate | (UserCreate)[]; connectOrCreate: {where:UserUnique;create:UserCreate} | {where:UserUnique;create:UserCreate}[]; upsert: {where:UserUnique;create:UserCreate;update:UserUpdate} | {where:UserUnique;create:UserCreate;update:UserUpdate}[]; updateMany: {where?:Where<Models,"User">;data:UserScalarUpdate} | {where?:Where<Models,"User">;data:UserScalarUpdate}[]; deleteMany: Where<Models,"User"> | Where<Models,"User">[]; disconnect: UserUnique | UserUnique[]; set: UserUnique[] }>;
export type UserUpdateAttachmentsInput = AtLeastOne<{ update: {where:AttachmentUnique;data:AttachmentUpdate} | {where:AttachmentUnique;data:AttachmentUpdate}[]; delete: AttachmentUnique | AttachmentUnique[]; create: AttachmentCreateWithoutAttachments | (AttachmentCreateWithoutAttachments)[]; upsert: {where:AttachmentUnique;create:AttachmentCreateWithoutAttachments;update:AttachmentUpdate} | {where:AttachmentUnique;create:AttachmentCreateWithoutAttachments;update:AttachmentUpdate}[]; updateMany: {where?:Where<Models,"Attachment">;data:AttachmentScalarUpdate} | {where?:Where<Models,"Attachment">;data:AttachmentScalarUpdate}[]; deleteMany: Where<Models,"Attachment"> | Where<Models,"Attachment">[]; createMany: {data:DistributiveOmit<AttachmentScalarCreate,"ownerId"|"ownerType">[];skipDuplicates?:boolean} }>;
export type PostCreateAuthorInput = OneOf<{ create: UserCreate; connect: UserUnique; connectOrCreate: { where: UserUnique; create: UserCreate } }>;
export type PostCreateTagsInput = AtLeastOne<{ create: TagCreate | (TagCreate)[]; connect: TagUnique | TagUnique[]; connectOrCreate: { where: TagUnique; create: TagCreate } | { where: TagUnique; create: TagCreate }[] }>;
export type PostCreateAttachmentsInput = AtLeastOne<{ create: AttachmentCreateWithoutAttachments | (AttachmentCreateWithoutAttachments)[]; createMany: { data: DistributiveOmit<AttachmentScalarCreate, "ownerId" | "ownerType">[]; skipDuplicates?: boolean } }>;
export type NoteCreateWithoutNotes = DistributiveOmit<NoteCreate, "holderId" | "holderType">;
export type PostCreateNotesInput = AtLeastOne<{ create: NoteCreateWithoutNotes | (NoteCreateWithoutNotes)[]; createMany: { data: DistributiveOmit<NoteScalarCreate, "holderId" | "holderType">[]; skipDuplicates?: boolean } }>;
export type PostUpdateAuthorInput = OneOf<{ update: UserUpdate; delete: true; connect: UserUnique; create: UserCreate; connectOrCreate: {where:UserUnique;create:UserCreate}; upsert: {create:UserCreate;update:UserUpdate} }>;
export type PostUpdateTagsInput = AtLeastOne<{ update: {where:TagUnique;data:TagUpdate} | {where:TagUnique;data:TagUpdate}[]; delete: TagUnique | TagUnique[]; connect: TagUnique | TagUnique[]; create: TagCreate | (TagCreate)[]; connectOrCreate: {where:TagUnique;create:TagCreate} | {where:TagUnique;create:TagCreate}[]; upsert: {where:TagUnique;create:TagCreate;update:TagUpdate} | {where:TagUnique;create:TagCreate;update:TagUpdate}[]; updateMany: {where?:Where<Models,"Tag">;data:TagScalarUpdate} | {where?:Where<Models,"Tag">;data:TagScalarUpdate}[]; deleteMany: Where<Models,"Tag"> | Where<Models,"Tag">[]; disconnect: TagUnique | TagUnique[]; set: TagUnique[] }>;
export type PostUpdateAttachmentsInput = AtLeastOne<{ update: {where:AttachmentUnique;data:AttachmentUpdate} | {where:AttachmentUnique;data:AttachmentUpdate}[]; delete: AttachmentUnique | AttachmentUnique[]; create: AttachmentCreateWithoutAttachments | (AttachmentCreateWithoutAttachments)[]; upsert: {where:AttachmentUnique;create:AttachmentCreateWithoutAttachments;update:AttachmentUpdate} | {where:AttachmentUnique;create:AttachmentCreateWithoutAttachments;update:AttachmentUpdate}[]; updateMany: {where?:Where<Models,"Attachment">;data:AttachmentScalarUpdate} | {where?:Where<Models,"Attachment">;data:AttachmentScalarUpdate}[]; deleteMany: Where<Models,"Attachment"> | Where<Models,"Attachment">[]; createMany: {data:DistributiveOmit<AttachmentScalarCreate,"ownerId"|"ownerType">[];skipDuplicates?:boolean} }>;
export type PostUpdateNotesInput = AtLeastOne<{ update: {where:NoteUnique;data:NoteUpdate} | {where:NoteUnique;data:NoteUpdate}[]; delete: NoteUnique | NoteUnique[]; create: NoteCreateWithoutNotes | (NoteCreateWithoutNotes)[]; upsert: {where:NoteUnique;create:NoteCreateWithoutNotes;update:NoteUpdate} | {where:NoteUnique;create:NoteCreateWithoutNotes;update:NoteUpdate}[]; updateMany: {where?:Where<Models,"Note">;data:NoteScalarUpdate} | {where?:Where<Models,"Note">;data:NoteScalarUpdate}[]; deleteMany: Where<Models,"Note"> | Where<Models,"Note">[]; createMany: {data:DistributiveOmit<NoteScalarCreate,"holderId"|"holderType">[];skipDuplicates?:boolean} }>;
export type ProfileCreateUserInput = OneOf<{ create: UserCreate; connect: UserUnique; connectOrCreate: { where: UserUnique; create: UserCreate } }>;
export type ProfileUpdateUserInput = OneOf<{ update: UserUpdate; delete: true; connect: UserUnique; create: UserCreate; connectOrCreate: {where:UserUnique;create:UserCreate}; upsert: {create:UserCreate;update:UserUpdate} }>;
export type CategoryCreateParentInput = OneOf<{ create: CategoryCreate; connect: CategoryUnique; connectOrCreate: { where: CategoryUnique; create: CategoryCreate } }>;
export type CategoryCreateWithoutParent = DistributiveOmit<CategoryCreate, "parentId" | "parent">;
export type CategoryCreateChildrenInput = AtLeastOne<{ create: CategoryCreateWithoutParent | (CategoryCreateWithoutParent)[]; connect: CategoryUnique | CategoryUnique[]; connectOrCreate: { where: CategoryUnique; create: CategoryCreateWithoutParent } | { where: CategoryUnique; create: CategoryCreateWithoutParent }[]; createMany: { data: DistributiveOmit<CategoryScalarCreate, "parentId">[]; skipDuplicates?: boolean } }>;
export type CategoryUpdateParentInput = OneOf<{ update: CategoryUpdate; delete: true; connect: CategoryUnique; create: CategoryCreate; connectOrCreate: {where:CategoryUnique;create:CategoryCreate}; upsert: {create:CategoryCreate;update:CategoryUpdate}; disconnect: true }>;
export type CategoryUpdateChildrenInput = AtLeastOne<{ update: {where:CategoryUnique;data:CategoryUpdate} | {where:CategoryUnique;data:CategoryUpdate}[]; delete: CategoryUnique | CategoryUnique[]; connect: CategoryUnique | CategoryUnique[]; create: CategoryCreateWithoutParent | (CategoryCreateWithoutParent)[]; connectOrCreate: {where:CategoryUnique;create:CategoryCreateWithoutParent} | {where:CategoryUnique;create:CategoryCreateWithoutParent}[]; upsert: {where:CategoryUnique;create:CategoryCreateWithoutParent;update:CategoryUpdate} | {where:CategoryUnique;create:CategoryCreateWithoutParent;update:CategoryUpdate}[]; updateMany: {where?:Where<Models,"Category">;data:CategoryScalarUpdate} | {where?:Where<Models,"Category">;data:CategoryScalarUpdate}[]; deleteMany: Where<Models,"Category"> | Where<Models,"Category">[]; createMany: {data:DistributiveOmit<CategoryScalarCreate,"parentId">[];skipDuplicates?:boolean}; disconnect: CategoryUnique | CategoryUnique[]; set: CategoryUnique[] }>;
export type AccountEntryCreateWithoutAccount = DistributiveOmit<AccountEntryCreate, "accountId" | "account">;
export type AccountCreateEntriesInput = AtLeastOne<{ create: AccountEntryCreateWithoutAccount | (AccountEntryCreateWithoutAccount)[]; connect: AccountEntryUnique | AccountEntryUnique[]; connectOrCreate: { where: AccountEntryUnique; create: AccountEntryCreateWithoutAccount } | { where: AccountEntryUnique; create: AccountEntryCreateWithoutAccount }[]; createMany: { data: DistributiveOmit<AccountEntryScalarCreate, "accountId">[]; skipDuplicates?: boolean } }>;
export type AccountUpdateEntriesInput = AtLeastOne<{ update: {where:AccountEntryUnique;data:AccountEntryUpdate} | {where:AccountEntryUnique;data:AccountEntryUpdate}[]; delete: AccountEntryUnique | AccountEntryUnique[]; connect: AccountEntryUnique | AccountEntryUnique[]; create: AccountEntryCreateWithoutAccount | (AccountEntryCreateWithoutAccount)[]; connectOrCreate: {where:AccountEntryUnique;create:AccountEntryCreateWithoutAccount} | {where:AccountEntryUnique;create:AccountEntryCreateWithoutAccount}[]; upsert: {where:AccountEntryUnique;create:AccountEntryCreateWithoutAccount;update:AccountEntryUpdate} | {where:AccountEntryUnique;create:AccountEntryCreateWithoutAccount;update:AccountEntryUpdate}[]; updateMany: {where?:Where<Models,"AccountEntry">;data:AccountEntryScalarUpdate} | {where?:Where<Models,"AccountEntry">;data:AccountEntryScalarUpdate}[]; deleteMany: Where<Models,"AccountEntry"> | Where<Models,"AccountEntry">[]; createMany: {data:DistributiveOmit<AccountEntryScalarCreate,"accountId">[];skipDuplicates?:boolean}; set: AccountEntryUnique[] }>;
export type AccountEntryCreateAccountInput = OneOf<{ create: AccountCreate; connect: AccountUnique; connectOrCreate: { where: AccountUnique; create: AccountCreate } }>;
export type AccountEntryUpdateAccountInput = OneOf<{ update: AccountUpdate; delete: true; connect: AccountUnique; create: AccountCreate; connectOrCreate: {where:AccountUnique;create:AccountCreate}; upsert: {create:AccountCreate;update:AccountUpdate} }>;
type AtLeastOne<T> = {[K in keyof T]:Required<Pick<T,K>> & Partial<Omit<T,K>>}[keyof T];
type OneOf<T> = {[K in keyof T]:{[P in K]:T[P]} & {[P in Exclude<keyof T,K>]?:never}}[keyof T];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Models = {
"User": { row: UserRow; create: UserCreate; update: UserUpdate; dateFields:"createdAt" | "updatedAt"; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:UserScalarCreate; scalarUpdate:UserScalarUpdate; unique: UserUnique; relations: { "following": { target: "User"; many: true; nullable: false }; "posts": { target: "Post"; many: true; nullable: false }; "profile": { target: "Profile"; many: false; nullable: true }; "followers": { target: "User"; many: true; nullable: false }; "attachments": { target: "Attachment"; many: true; nullable: false } } };
"Post": { row: PostRow; create: PostCreate; update: PostUpdate; dateFields:never; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:PostScalarCreate; scalarUpdate:PostScalarUpdate; unique: PostUnique; relations: { "author": { target: "User"; many: false; nullable: false }; "tags": { target: "Tag"; many: true; nullable: false }; "attachments": { target: "Attachment"; many: true; nullable: false }; "notes": { target: "Note"; many: true; nullable: false } } };
"Profile": { row: ProfileRow; create: ProfileCreate; update: ProfileUpdate; dateFields:never; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:ProfileScalarCreate; scalarUpdate:ProfileScalarUpdate; unique: ProfileUnique; relations: { "user": { target: "User"; many: false; nullable: false } } };
"Tag": { row: TagRow; create: TagCreate; update: TagUpdate; dateFields:never; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:TagScalarCreate; scalarUpdate:TagScalarUpdate; unique: TagUnique; relations: {  } };
"Category": { row: CategoryRow; create: CategoryCreate; update: CategoryUpdate; dateFields:never; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:CategoryScalarCreate; scalarUpdate:CategoryScalarUpdate; unique: CategoryUnique; relations: { "parent": { target: "Category"; many: false; nullable: true }; "children": { target: "Category"; many: true; nullable: false } } };
"Slot": { row: SlotRow; create: SlotCreate; update: SlotUpdate; dateFields:never; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:SlotScalarCreate; scalarUpdate:SlotScalarUpdate; unique: SlotUnique; relations: {  } };
"Product": { row: ProductRow; create: ProductCreate; update: ProductUpdate; dateFields:never; bigintFields:"stock"; decimalFields:"price"; jsonFields:never; scalarCreate:ProductScalarCreate; scalarUpdate:ProductScalarUpdate; unique: ProductUnique; relations: {  } };
"Account": { row: AccountRow; create: AccountCreate; update: AccountUpdate; dateFields:"deletedAt"; bigintFields:never; decimalFields:never; jsonFields:"preferences"; scalarCreate:AccountScalarCreate; scalarUpdate:AccountScalarUpdate; unique: AccountUnique; relations: { "entries": { target: "AccountEntry"; many: true; nullable: false } } };
"AccountEntry": { row: AccountEntryRow; create: AccountEntryCreate; update: AccountEntryUpdate; dateFields:"deletedAt"; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:AccountEntryScalarCreate; scalarUpdate:AccountEntryScalarUpdate; unique: AccountEntryUnique; relations: { "account": { target: "Account"; many: false; nullable: false } } };
"Attachment": { row: AttachmentRow; create: AttachmentCreate; update: AttachmentUpdate; dateFields:never; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:AttachmentScalarCreate; scalarUpdate:AttachmentScalarUpdate; unique: AttachmentUnique; relations: {  } };
"Note": { row: NoteRow; create: NoteCreate; update: NoteUpdate; dateFields:never; bigintFields:never; decimalFields:never; jsonFields:never; scalarCreate:NoteScalarCreate; scalarUpdate:NoteScalarUpdate; unique: NoteUnique; relations: {  } };
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
          "maxLength": 191,
          "default": null
        },
        "role": {
          "name": "role",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "enum": [
            "admin",
            "member"
          ],
          "maxLength": 191,
          "default": "member"
        },
        "createdAt": {
          "name": "createdAt",
          "type": "datetime",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": {
            "fn": "now"
          }
        },
        "updatedAt": {
          "name": "updatedAt",
          "type": "datetime",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "updatedAt": true
        }
      },
      "relations": {
        "following": {
          "name": "following",
          "target": "User",
          "many": true,
          "nullable": false,
          "owner": true,
          "source": "id",
          "foreign": "id",
          "junction": "_User_following",
          "junctionSource": "sourceId",
          "junctionTarget": "targetId"
        },
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
        },
        "followers": {
          "name": "followers",
          "target": "User",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "id",
          "junction": "_User_following",
          "junctionSource": "targetId",
          "junctionTarget": "sourceId"
        },
        "attachments": {
          "name": "attachments",
          "target": "Attachment",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "ownerId",
          "polymorphic": true,
          "discriminator": "ownerType",
          "discriminatorValue": "User"
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
          "unique": false,
          "maxLength": 200
        },
        "body": {
          "name": "body",
          "type": "text",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
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
        "authorId": {
          "name": "authorId",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
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
          "foreign": "id",
          "onDelete": "Cascade"
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
        },
        "attachments": {
          "name": "attachments",
          "target": "Attachment",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "ownerId",
          "polymorphic": true,
          "discriminator": "ownerType",
          "discriminatorValue": "Post"
        },
        "notes": {
          "name": "notes",
          "target": "Note",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "holderId",
          "polymorphic": true,
          "discriminator": "holderType",
          "discriminatorValue": "Post"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": [
        [
          "published"
        ]
      ]
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
          "maxLength": 191,
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
          "foreign": "id",
          "onDelete": "Cascade"
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
      "relations": {},
      "primary": "id",
      "unique": [],
      "indexes": []
    },
    "Category": {
      "name": "Category",
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
          "unique": false,
          "maxLength": 64
        },
        "parentId": {
          "name": "parentId",
          "type": "int",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
        }
      },
      "relations": {
        "parent": {
          "name": "parent",
          "target": "Category",
          "many": false,
          "nullable": true,
          "owner": true,
          "source": "parentId",
          "foreign": "id",
          "onDelete": "SetNull"
        },
        "children": {
          "name": "children",
          "target": "Category",
          "many": true,
          "nullable": false,
          "owner": false,
          "source": "id",
          "foreign": "parentId"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": []
    },
    "Slot": {
      "name": "Slot",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "owner": {
          "name": "owner",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "maxLength": 64
        },
        "slot": {
          "name": "slot",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        }
      },
      "relations": {},
      "primary": "id",
      "unique": [
        [
          "owner",
          "slot"
        ]
      ],
      "indexes": []
    },
    "Product": {
      "name": "Product",
      "columns": {
        "id": {
          "name": "id",
          "type": "string",
          "nullable": false,
          "primary": true,
          "auto": false,
          "unique": false,
          "maxLength": 36,
          "default": {
            "fn": "uuid"
          }
        },
        "sku": {
          "name": "sku",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": true,
          "maxLength": 32,
          "map": "product_sku"
        },
        "price": {
          "name": "price",
          "type": "decimal",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "precision": 10,
          "scale": 2
        },
        "stock": {
          "name": "stock",
          "type": "bigint",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": 0
        },
        "payload": {
          "name": "payload",
          "type": "bytes",
          "nullable": true,
          "primary": false,
          "auto": false,
          "unique": false,
          "default": null
        }
      },
      "relations": {},
      "primary": "id",
      "unique": [],
      "indexes": [],
      "map": "products"
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
          "type": "datetime",
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
          "unique": false,
          "maxLength": 191
        },
        "deletedAt": {
          "name": "deletedAt",
          "type": "datetime",
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
    },
    "Attachment": {
      "name": "Attachment",
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
          "unique": false,
          "maxLength": 191
        },
        "ownerType": {
          "name": "ownerType",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "enum": [
            "Post",
            "User"
          ],
          "maxLength": 191
        },
        "ownerId": {
          "name": "ownerId",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        }
      },
      "relations": {
        "owner": {
          "name": "owner",
          "target": "",
          "many": false,
          "nullable": false,
          "owner": true,
          "source": "ownerId",
          "foreign": "",
          "polymorphic": true,
          "discriminator": "ownerType"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": []
    },
    "Note": {
      "name": "Note",
      "columns": {
        "id": {
          "name": "id",
          "type": "int",
          "nullable": false,
          "primary": true,
          "auto": true,
          "unique": false
        },
        "body": {
          "name": "body",
          "type": "string",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false,
          "maxLength": 191
        },
        "holderType": {
          "name": "holderType",
          "type": "string",
          "maxLength": 191,
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        },
        "holderId": {
          "name": "holderId",
          "type": "int",
          "nullable": false,
          "primary": false,
          "auto": false,
          "unique": false
        }
      },
      "relations": {
        "holder": {
          "name": "holder",
          "target": "",
          "many": false,
          "nullable": false,
          "owner": true,
          "source": "holderId",
          "foreign": "",
          "polymorphic": true,
          "discriminator": "holderType"
        }
      },
      "primary": "id",
      "unique": [],
      "indexes": [
        [
          "holderType",
          "holderId"
        ]
      ]
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
export const createClient = (options: ClientOptions) => {
  return createORMClient<Models>(schema, options);
};
