// Generated from schema.orm. Do not edit.
import { createClient as createORMClient } from "../../src/index.js";
import type { Schema, ClientOptions, FieldUpdate, DecimalUpdate, Where, DateTime, DateTimeInput, JsonInput, Invalid } from "../../src/index.js";
export type Settings = {
  theme: "light" | "dark";
  notifications: boolean;
  tags: string[];
  score?: number;
};
export type UserRow = {
  id: number;
  email: string;
  name: string | null;
  role: "admin" | "member";
  age: number | null;
  createdAt: DateTime;
  updatedAt: DateTime;
};
export type UserCreate = {
  email: string;
  name?: string | null;
  role?: "admin" | "member";
  age?: number | null;
  createdAt?: DateTimeInput;
  updatedAt?: DateTimeInput;
  id?: never;
} & {
  following?: UserCreateFollowingInput;
  posts?: UserCreatePostsInput;
  reviewed?: UserCreateReviewedInput;
  profile?: UserCreateProfileInput;
  comments?: UserCreateCommentsInput;
  followers?: UserCreateFollowersInput;
  attachments?: UserCreateAttachmentsInput;
};
export type UserScalarUpdate = {
  email?: FieldUpdate<string>;
  name?: FieldUpdate<string | null>;
  role?: FieldUpdate<"admin" | "member">;
  age?: FieldUpdate<number | null>;
  createdAt?: FieldUpdate<DateTimeInput>;
  updatedAt?: FieldUpdate<DateTimeInput>;
};
export type UserUpdate = UserScalarUpdate & {
  following?: UserUpdateFollowingInput;
  posts?: UserUpdatePostsInput;
  reviewed?: UserUpdateReviewedInput;
  profile?: UserUpdateProfileInput;
  comments?: UserUpdateCommentsInput;
  followers?: UserUpdateFollowersInput;
  attachments?: UserUpdateAttachmentsInput;
};
export type UserScalarCreate = {
  id?: never;
  email: string;
  name?: string | null;
  role?: "admin" | "member";
  age?: number | null;
  createdAt?: DateTimeInput;
  updatedAt?: DateTimeInput;
};
export type UserUnique = { id: number } | { email: string };
export type ProfileRow = {
  id: number;
  bio: string;
  userId: number;
};
export type ProfileCreate = { bio?: string; id?: never } & ({ userId?: Invalid<"Use either userId or user, not both">; user: ProfileCreateUserInput } | { userId: number; user?: Invalid<"Use either userId or user, not both"> });
export type ProfileScalarUpdate = { bio?: FieldUpdate<string>; userId?: FieldUpdate<number> };
export type ProfileUpdate = ProfileScalarUpdate & { user?: ProfileUpdateUserInput };
export type ProfileScalarCreate = { id?: never; bio?: string; userId: number };
export type ProfileUnique = { id: number } | { userId: number };
export type PostRow = {
  id: number;
  title: string;
  content: string | null;
  published: boolean;
  views: number;
  rating: number | null;
  createdAt: DateTime;
  authorId: number;
  reviewerId: number | null;
};
export type PostCreate = {
  title: string;
  content?: string | null;
  published?: boolean;
  views?: number;
  rating?: number | null;
  createdAt?: DateTimeInput;
  id?: never;
} & ({ authorId?: Invalid<"Use either authorId or author, not both">; author: PostCreateAuthorInput } | { authorId: number; author?: Invalid<"Use either authorId or author, not both"> }) &
  (
    | {
        reviewerId?: Invalid<"Use either reviewerId or reviewer, not both">;
        reviewer: PostCreateReviewerInput;
      }
    | {
        reviewerId?: number | null;
        reviewer?: Invalid<"Use either reviewerId or reviewer, not both">;
      }
  ) & {
    tags?: PostCreateTagsInput;
    comments?: PostCreateCommentsInput;
    attachments?: PostCreateAttachmentsInput;
    notes?: PostCreateNotesInput;
  };
export type PostScalarUpdate = {
  title?: FieldUpdate<string>;
  content?: FieldUpdate<string | null>;
  published?: FieldUpdate<boolean>;
  views?: FieldUpdate<number>;
  rating?: FieldUpdate<number | null>;
  createdAt?: FieldUpdate<DateTimeInput>;
  authorId?: FieldUpdate<number>;
  reviewerId?: FieldUpdate<number | null>;
};
export type PostUpdate = PostScalarUpdate & {
  author?: PostUpdateAuthorInput;
  reviewer?: PostUpdateReviewerInput;
  tags?: PostUpdateTagsInput;
  comments?: PostUpdateCommentsInput;
  attachments?: PostUpdateAttachmentsInput;
  notes?: PostUpdateNotesInput;
};
export type PostScalarCreate = {
  id?: never;
  title: string;
  content?: string | null;
  published?: boolean;
  views?: number;
  rating?: number | null;
  createdAt?: DateTimeInput;
  authorId: number;
  reviewerId?: number | null;
};
export type PostUnique = { id: number };
export type CommentRow = {
  id: number;
  body: string;
  postId: number;
  authorId: number;
};
export type CommentCreate = { body: string; id?: never } & ({ postId?: Invalid<"Use either postId or post, not both">; post: CommentCreatePostInput } | { postId: number; post?: Invalid<"Use either postId or post, not both"> }) &
  (
    | {
        authorId?: Invalid<"Use either authorId or author, not both">;
        author: CommentCreateAuthorInput;
      }
    | { authorId: number; author?: Invalid<"Use either authorId or author, not both"> }
  );
export type CommentScalarUpdate = {
  body?: FieldUpdate<string>;
  postId?: FieldUpdate<number>;
  authorId?: FieldUpdate<number>;
};
export type CommentUpdate = CommentScalarUpdate & {
  post?: CommentUpdatePostInput;
  author?: CommentUpdateAuthorInput;
};
export type CommentScalarCreate = { id?: never; body: string; postId: number; authorId: number };
export type CommentUnique = { id: number };
export type TagRow = {
  id: number;
  name: string;
};
export type TagCreate = { name: string; id?: never } & { posts?: TagCreatePostsInput };
export type TagScalarUpdate = { name?: FieldUpdate<string> };
export type TagUpdate = TagScalarUpdate & { posts?: TagUpdatePostsInput };
export type TagScalarCreate = { id?: never; name: string };
export type TagUnique = { id: number } | { name: string };
export type CategoryRow = {
  id: number;
  name: string;
  parentId: number | null;
};
export type CategoryCreate = { name: string; id?: never } & (
  | {
      parentId?: Invalid<"Use either parentId or parent, not both">;
      parent: CategoryCreateParentInput;
    }
  | { parentId?: number | null; parent?: Invalid<"Use either parentId or parent, not both"> }
) & { children?: CategoryCreateChildrenInput };
export type CategoryScalarUpdate = {
  name?: FieldUpdate<string>;
  parentId?: FieldUpdate<number | null>;
};
export type CategoryUpdate = CategoryScalarUpdate & {
  parent?: CategoryUpdateParentInput;
  children?: CategoryUpdateChildrenInput;
};
export type CategoryScalarCreate = { id?: never; name: string; parentId?: number | null };
export type CategoryUnique = { id: number };
export type MembershipRow = {
  organization: string;
  email: string;
  level: number;
};
export type MembershipCreate = { organization: string; email: string; level?: number };
export type MembershipScalarUpdate = { level?: FieldUpdate<number> };
export type MembershipUpdate = MembershipScalarUpdate;
export type MembershipScalarCreate = { organization: string; email: string; level?: number };
export type MembershipUnique = { organization: string; email: string };
export type ProductRow = {
  id: string;
  sku: string;
  price: string;
  stock: string;
  payload: Uint8Array | null;
  active: boolean;
};
export type ProductCreate = {
  id?: string;
  sku: string;
  price: string | number;
  stock?: bigint | string | number;
  payload?: Uint8Array | null;
  active?: boolean;
};
export type ProductScalarUpdate = {
  sku?: FieldUpdate<string>;
  price?: DecimalUpdate<string | number>;
  stock?: FieldUpdate<bigint | string | number>;
  payload?: FieldUpdate<Uint8Array | null>;
  active?: FieldUpdate<boolean>;
};
export type ProductUpdate = ProductScalarUpdate;
export type ProductScalarCreate = {
  id?: string;
  sku: string;
  price: string | number;
  stock?: bigint | string | number;
  payload?: Uint8Array | null;
  active?: boolean;
};
export type ProductUnique = { id: string } | { sku: string };
export type SlotRow = {
  id: number;
  owner: string;
  slot: number;
};
export type SlotCreate = { owner: string; slot: number; id?: never };
export type SlotScalarUpdate = { owner?: FieldUpdate<string>; slot?: FieldUpdate<number> };
export type SlotUpdate = SlotScalarUpdate;
export type SlotScalarCreate = { id?: never; owner: string; slot: number };
export type SlotUnique = { id: number } | { owner: string; slot: number };
export type AccountRow = {
  id: number;
  email: string;
  name: string | null;
  settings: Settings | null;
  deletedAt: DateTime | null;
};
export type AccountCreate = {
  email: string;
  name?: string | null;
  settings?: JsonInput<Settings, true> | null;
  id?: never;
} & { entries?: AccountCreateEntriesInput };
export type AccountScalarUpdate = {
  email?: FieldUpdate<string>;
  name?: FieldUpdate<string | null>;
  settings?: FieldUpdate<JsonInput<Settings, true> | null>;
};
export type AccountUpdate = AccountScalarUpdate & { entries?: AccountUpdateEntriesInput };
export type AccountScalarCreate = {
  id?: never;
  email: string;
  name?: string | null;
  settings?: JsonInput<Settings, true> | null;
  deletedAt?: never;
};
export type AccountUnique = { id: number } | { email: string };
export type EntryRow = {
  id: number;
  title: string;
  deletedAt: DateTime | null;
  accountId: number;
};
export type EntryCreate = { title: string; id?: never } & (
  | {
      accountId?: Invalid<"Use either accountId or account, not both">;
      account: EntryCreateAccountInput;
    }
  | { accountId: number; account?: Invalid<"Use either accountId or account, not both"> }
);
export type EntryScalarUpdate = { title?: FieldUpdate<string>; accountId?: FieldUpdate<number> };
export type EntryUpdate = EntryScalarUpdate & { account?: EntryUpdateAccountInput };
export type EntryScalarCreate = { id?: never; title: string; deletedAt?: never; accountId: number };
export type EntryUnique = { id: number };
export type AttachmentRow = {
  id: number;
  name: string;
  ownerType: "Post" | "User";
  ownerId: number;
  deletedAt: DateTime | null;
};
export type AttachmentCreate = {
  name: string;
  ownerType: "Post" | "User";
  ownerId: number;
  id?: never;
};
export type AttachmentScalarUpdate = {
  name?: FieldUpdate<string>;
  ownerType?: FieldUpdate<"Post" | "User">;
  ownerId?: FieldUpdate<number>;
};
export type AttachmentUpdate = AttachmentScalarUpdate;
export type AttachmentScalarCreate = {
  id?: never;
  name: string;
  ownerType: "Post" | "User";
  ownerId: number;
  deletedAt?: never;
};
export type AttachmentUnique = { id: number };
export type NoteRow = {
  id: number;
  body: string;
  holderType: string;
  holderId: number;
};
export type NoteCreate = { body: string; holderType: string; holderId: number; id?: never };
export type NoteScalarUpdate = {
  body?: FieldUpdate<string>;
  holderType?: FieldUpdate<string>;
  holderId?: FieldUpdate<number>;
};
export type NoteUpdate = NoteScalarUpdate;
export type NoteScalarCreate = { id?: never; body: string; holderType: string; holderId: number };
export type NoteUnique = { id: number };
export type UserCreateFollowingInput = AtLeastOne<{
  create: UserCreate | UserCreate[];
  connect: UserUnique | UserUnique[];
  connectOrCreate: { where: UserUnique; create: UserCreate } | { where: UserUnique; create: UserCreate }[];
}>;
export type PostCreateWithoutAuthor = DistributiveOmit<PostCreate, "authorId" | "author">;
export type UserCreatePostsInput = AtLeastOne<{
  create: PostCreateWithoutAuthor | PostCreateWithoutAuthor[];
  connect: PostUnique | PostUnique[];
  connectOrCreate: { where: PostUnique; create: PostCreateWithoutAuthor } | { where: PostUnique; create: PostCreateWithoutAuthor }[];
  createMany: { data: DistributiveOmit<PostScalarCreate, "authorId">[]; skipDuplicates?: boolean };
}>;
export type PostCreateWithoutReviewer = DistributiveOmit<PostCreate, "reviewerId" | "reviewer">;
export type UserCreateReviewedInput = AtLeastOne<{
  create: PostCreateWithoutReviewer | PostCreateWithoutReviewer[];
  connect: PostUnique | PostUnique[];
  connectOrCreate: { where: PostUnique; create: PostCreateWithoutReviewer } | { where: PostUnique; create: PostCreateWithoutReviewer }[];
  createMany: {
    data: DistributiveOmit<PostScalarCreate, "reviewerId">[];
    skipDuplicates?: boolean;
  };
}>;
export type ProfileCreateWithoutUser = DistributiveOmit<ProfileCreate, "userId" | "user">;
export type UserCreateProfileInput = OneOf<{
  create: ProfileCreateWithoutUser;
  connect: ProfileUnique;
  connectOrCreate: { where: ProfileUnique; create: ProfileCreateWithoutUser };
}>;
export type CommentCreateWithoutAuthor = DistributiveOmit<CommentCreate, "authorId" | "author">;
export type UserCreateCommentsInput = AtLeastOne<{
  create: CommentCreateWithoutAuthor | CommentCreateWithoutAuthor[];
  connect: CommentUnique | CommentUnique[];
  connectOrCreate: { where: CommentUnique; create: CommentCreateWithoutAuthor } | { where: CommentUnique; create: CommentCreateWithoutAuthor }[];
  createMany: {
    data: DistributiveOmit<CommentScalarCreate, "authorId">[];
    skipDuplicates?: boolean;
  };
}>;
export type UserCreateFollowersInput = AtLeastOne<{
  create: UserCreate | UserCreate[];
  connect: UserUnique | UserUnique[];
  connectOrCreate: { where: UserUnique; create: UserCreate } | { where: UserUnique; create: UserCreate }[];
}>;
export type AttachmentCreateWithoutAttachments = DistributiveOmit<AttachmentCreate, "ownerId" | "ownerType">;
export type UserCreateAttachmentsInput = AtLeastOne<{
  create: AttachmentCreateWithoutAttachments | AttachmentCreateWithoutAttachments[];
  createMany: {
    data: DistributiveOmit<AttachmentScalarCreate, "ownerId" | "ownerType">[];
    skipDuplicates?: boolean;
  };
}>;
export type UserUpdateFollowingInput = AtLeastOne<{
  update: { where: UserUnique; data: UserUpdate } | { where: UserUnique; data: UserUpdate }[];
  delete: UserUnique | UserUnique[];
  connect: UserUnique | UserUnique[];
  create: UserCreate | UserCreate[];
  connectOrCreate: { where: UserUnique; create: UserCreate } | { where: UserUnique; create: UserCreate }[];
  upsert: { where: UserUnique; create: UserCreate; update: UserUpdate } | { where: UserUnique; create: UserCreate; update: UserUpdate }[];
  updateMany: { where?: Where<Models, "User">; data: UserScalarUpdate } | { where?: Where<Models, "User">; data: UserScalarUpdate }[];
  deleteMany: Where<Models, "User"> | Where<Models, "User">[];
  disconnect: UserUnique | UserUnique[];
  set: UserUnique[];
}>;
export type UserUpdatePostsInput = AtLeastOne<{
  update: { where: PostUnique; data: PostUpdate } | { where: PostUnique; data: PostUpdate }[];
  delete: PostUnique | PostUnique[];
  connect: PostUnique | PostUnique[];
  create: PostCreateWithoutAuthor | PostCreateWithoutAuthor[];
  connectOrCreate: { where: PostUnique; create: PostCreateWithoutAuthor } | { where: PostUnique; create: PostCreateWithoutAuthor }[];
  upsert: { where: PostUnique; create: PostCreateWithoutAuthor; update: PostUpdate } | { where: PostUnique; create: PostCreateWithoutAuthor; update: PostUpdate }[];
  updateMany: { where?: Where<Models, "Post">; data: PostScalarUpdate } | { where?: Where<Models, "Post">; data: PostScalarUpdate }[];
  deleteMany: Where<Models, "Post"> | Where<Models, "Post">[];
  createMany: { data: DistributiveOmit<PostScalarCreate, "authorId">[]; skipDuplicates?: boolean };
  set: PostUnique[];
}>;
export type UserUpdateReviewedInput = AtLeastOne<{
  update: { where: PostUnique; data: PostUpdate } | { where: PostUnique; data: PostUpdate }[];
  delete: PostUnique | PostUnique[];
  connect: PostUnique | PostUnique[];
  create: PostCreateWithoutReviewer | PostCreateWithoutReviewer[];
  connectOrCreate: { where: PostUnique; create: PostCreateWithoutReviewer } | { where: PostUnique; create: PostCreateWithoutReviewer }[];
  upsert: { where: PostUnique; create: PostCreateWithoutReviewer; update: PostUpdate } | { where: PostUnique; create: PostCreateWithoutReviewer; update: PostUpdate }[];
  updateMany: { where?: Where<Models, "Post">; data: PostScalarUpdate } | { where?: Where<Models, "Post">; data: PostScalarUpdate }[];
  deleteMany: Where<Models, "Post"> | Where<Models, "Post">[];
  createMany: {
    data: DistributiveOmit<PostScalarCreate, "reviewerId">[];
    skipDuplicates?: boolean;
  };
  disconnect: PostUnique | PostUnique[];
  set: PostUnique[];
}>;
export type UserUpdateProfileInput = OneOf<{
  update: ProfileUpdate;
  delete: true;
  connect: ProfileUnique;
  create: ProfileCreateWithoutUser;
  connectOrCreate: { where: ProfileUnique; create: ProfileCreateWithoutUser };
  upsert: { create: ProfileCreateWithoutUser; update: ProfileUpdate };
}>;
export type UserUpdateCommentsInput = AtLeastOne<{
  update: { where: CommentUnique; data: CommentUpdate } | { where: CommentUnique; data: CommentUpdate }[];
  delete: CommentUnique | CommentUnique[];
  connect: CommentUnique | CommentUnique[];
  create: CommentCreateWithoutAuthor | CommentCreateWithoutAuthor[];
  connectOrCreate: { where: CommentUnique; create: CommentCreateWithoutAuthor } | { where: CommentUnique; create: CommentCreateWithoutAuthor }[];
  upsert: { where: CommentUnique; create: CommentCreateWithoutAuthor; update: CommentUpdate } | { where: CommentUnique; create: CommentCreateWithoutAuthor; update: CommentUpdate }[];
  updateMany: { where?: Where<Models, "Comment">; data: CommentScalarUpdate } | { where?: Where<Models, "Comment">; data: CommentScalarUpdate }[];
  deleteMany: Where<Models, "Comment"> | Where<Models, "Comment">[];
  createMany: {
    data: DistributiveOmit<CommentScalarCreate, "authorId">[];
    skipDuplicates?: boolean;
  };
  set: CommentUnique[];
}>;
export type UserUpdateFollowersInput = AtLeastOne<{
  update: { where: UserUnique; data: UserUpdate } | { where: UserUnique; data: UserUpdate }[];
  delete: UserUnique | UserUnique[];
  connect: UserUnique | UserUnique[];
  create: UserCreate | UserCreate[];
  connectOrCreate: { where: UserUnique; create: UserCreate } | { where: UserUnique; create: UserCreate }[];
  upsert: { where: UserUnique; create: UserCreate; update: UserUpdate } | { where: UserUnique; create: UserCreate; update: UserUpdate }[];
  updateMany: { where?: Where<Models, "User">; data: UserScalarUpdate } | { where?: Where<Models, "User">; data: UserScalarUpdate }[];
  deleteMany: Where<Models, "User"> | Where<Models, "User">[];
  disconnect: UserUnique | UserUnique[];
  set: UserUnique[];
}>;
export type UserUpdateAttachmentsInput = AtLeastOne<{
  update: { where: AttachmentUnique; data: AttachmentUpdate } | { where: AttachmentUnique; data: AttachmentUpdate }[];
  delete: AttachmentUnique | AttachmentUnique[];
  create: AttachmentCreateWithoutAttachments | AttachmentCreateWithoutAttachments[];
  upsert:
    | {
        where: AttachmentUnique;
        create: AttachmentCreateWithoutAttachments;
        update: AttachmentUpdate;
      }
    | {
        where: AttachmentUnique;
        create: AttachmentCreateWithoutAttachments;
        update: AttachmentUpdate;
      }[];
  updateMany: { where?: Where<Models, "Attachment">; data: AttachmentScalarUpdate } | { where?: Where<Models, "Attachment">; data: AttachmentScalarUpdate }[];
  deleteMany: Where<Models, "Attachment"> | Where<Models, "Attachment">[];
  createMany: {
    data: DistributiveOmit<AttachmentScalarCreate, "ownerId" | "ownerType">[];
    skipDuplicates?: boolean;
  };
}>;
export type ProfileCreateUserInput = OneOf<{
  create: UserCreate;
  connect: UserUnique;
  connectOrCreate: { where: UserUnique; create: UserCreate };
}>;
export type ProfileUpdateUserInput = OneOf<{
  update: UserUpdate;
  delete: true;
  connect: UserUnique;
  create: UserCreate;
  connectOrCreate: { where: UserUnique; create: UserCreate };
  upsert: { create: UserCreate; update: UserUpdate };
}>;
export type PostCreateAuthorInput = OneOf<{
  create: UserCreate;
  connect: UserUnique;
  connectOrCreate: { where: UserUnique; create: UserCreate };
}>;
export type PostCreateReviewerInput = OneOf<{
  create: UserCreate;
  connect: UserUnique;
  connectOrCreate: { where: UserUnique; create: UserCreate };
}>;
export type PostCreateTagsInput = AtLeastOne<{
  create: TagCreate | TagCreate[];
  connect: TagUnique | TagUnique[];
  connectOrCreate: { where: TagUnique; create: TagCreate } | { where: TagUnique; create: TagCreate }[];
}>;
export type CommentCreateWithoutPost = DistributiveOmit<CommentCreate, "postId" | "post">;
export type PostCreateCommentsInput = AtLeastOne<{
  create: CommentCreateWithoutPost | CommentCreateWithoutPost[];
  connect: CommentUnique | CommentUnique[];
  connectOrCreate: { where: CommentUnique; create: CommentCreateWithoutPost } | { where: CommentUnique; create: CommentCreateWithoutPost }[];
  createMany: { data: DistributiveOmit<CommentScalarCreate, "postId">[]; skipDuplicates?: boolean };
}>;
export type PostCreateAttachmentsInput = AtLeastOne<{
  create: AttachmentCreateWithoutAttachments | AttachmentCreateWithoutAttachments[];
  createMany: {
    data: DistributiveOmit<AttachmentScalarCreate, "ownerId" | "ownerType">[];
    skipDuplicates?: boolean;
  };
}>;
export type NoteCreateWithoutNotes = DistributiveOmit<NoteCreate, "holderId" | "holderType">;
export type PostCreateNotesInput = AtLeastOne<{
  create: NoteCreateWithoutNotes | NoteCreateWithoutNotes[];
  createMany: {
    data: DistributiveOmit<NoteScalarCreate, "holderId" | "holderType">[];
    skipDuplicates?: boolean;
  };
}>;
export type PostUpdateAuthorInput = OneOf<{
  update: UserUpdate;
  delete: true;
  connect: UserUnique;
  create: UserCreate;
  connectOrCreate: { where: UserUnique; create: UserCreate };
  upsert: { create: UserCreate; update: UserUpdate };
}>;
export type PostUpdateReviewerInput = OneOf<{
  update: UserUpdate;
  delete: true;
  connect: UserUnique;
  create: UserCreate;
  connectOrCreate: { where: UserUnique; create: UserCreate };
  upsert: { create: UserCreate; update: UserUpdate };
  disconnect: true;
}>;
export type PostUpdateTagsInput = AtLeastOne<{
  update: { where: TagUnique; data: TagUpdate } | { where: TagUnique; data: TagUpdate }[];
  delete: TagUnique | TagUnique[];
  connect: TagUnique | TagUnique[];
  create: TagCreate | TagCreate[];
  connectOrCreate: { where: TagUnique; create: TagCreate } | { where: TagUnique; create: TagCreate }[];
  upsert: { where: TagUnique; create: TagCreate; update: TagUpdate } | { where: TagUnique; create: TagCreate; update: TagUpdate }[];
  updateMany: { where?: Where<Models, "Tag">; data: TagScalarUpdate } | { where?: Where<Models, "Tag">; data: TagScalarUpdate }[];
  deleteMany: Where<Models, "Tag"> | Where<Models, "Tag">[];
  disconnect: TagUnique | TagUnique[];
  set: TagUnique[];
}>;
export type PostUpdateCommentsInput = AtLeastOne<{
  update: { where: CommentUnique; data: CommentUpdate } | { where: CommentUnique; data: CommentUpdate }[];
  delete: CommentUnique | CommentUnique[];
  connect: CommentUnique | CommentUnique[];
  create: CommentCreateWithoutPost | CommentCreateWithoutPost[];
  connectOrCreate: { where: CommentUnique; create: CommentCreateWithoutPost } | { where: CommentUnique; create: CommentCreateWithoutPost }[];
  upsert: { where: CommentUnique; create: CommentCreateWithoutPost; update: CommentUpdate } | { where: CommentUnique; create: CommentCreateWithoutPost; update: CommentUpdate }[];
  updateMany: { where?: Where<Models, "Comment">; data: CommentScalarUpdate } | { where?: Where<Models, "Comment">; data: CommentScalarUpdate }[];
  deleteMany: Where<Models, "Comment"> | Where<Models, "Comment">[];
  createMany: { data: DistributiveOmit<CommentScalarCreate, "postId">[]; skipDuplicates?: boolean };
  set: CommentUnique[];
}>;
export type PostUpdateAttachmentsInput = AtLeastOne<{
  update: { where: AttachmentUnique; data: AttachmentUpdate } | { where: AttachmentUnique; data: AttachmentUpdate }[];
  delete: AttachmentUnique | AttachmentUnique[];
  create: AttachmentCreateWithoutAttachments | AttachmentCreateWithoutAttachments[];
  upsert:
    | {
        where: AttachmentUnique;
        create: AttachmentCreateWithoutAttachments;
        update: AttachmentUpdate;
      }
    | {
        where: AttachmentUnique;
        create: AttachmentCreateWithoutAttachments;
        update: AttachmentUpdate;
      }[];
  updateMany: { where?: Where<Models, "Attachment">; data: AttachmentScalarUpdate } | { where?: Where<Models, "Attachment">; data: AttachmentScalarUpdate }[];
  deleteMany: Where<Models, "Attachment"> | Where<Models, "Attachment">[];
  createMany: {
    data: DistributiveOmit<AttachmentScalarCreate, "ownerId" | "ownerType">[];
    skipDuplicates?: boolean;
  };
}>;
export type PostUpdateNotesInput = AtLeastOne<{
  update: { where: NoteUnique; data: NoteUpdate } | { where: NoteUnique; data: NoteUpdate }[];
  delete: NoteUnique | NoteUnique[];
  create: NoteCreateWithoutNotes | NoteCreateWithoutNotes[];
  upsert: { where: NoteUnique; create: NoteCreateWithoutNotes; update: NoteUpdate } | { where: NoteUnique; create: NoteCreateWithoutNotes; update: NoteUpdate }[];
  updateMany: { where?: Where<Models, "Note">; data: NoteScalarUpdate } | { where?: Where<Models, "Note">; data: NoteScalarUpdate }[];
  deleteMany: Where<Models, "Note"> | Where<Models, "Note">[];
  createMany: {
    data: DistributiveOmit<NoteScalarCreate, "holderId" | "holderType">[];
    skipDuplicates?: boolean;
  };
}>;
export type CommentCreatePostInput = OneOf<{
  create: PostCreate;
  connect: PostUnique;
  connectOrCreate: { where: PostUnique; create: PostCreate };
}>;
export type CommentCreateAuthorInput = OneOf<{
  create: UserCreate;
  connect: UserUnique;
  connectOrCreate: { where: UserUnique; create: UserCreate };
}>;
export type CommentUpdatePostInput = OneOf<{
  update: PostUpdate;
  delete: true;
  connect: PostUnique;
  create: PostCreate;
  connectOrCreate: { where: PostUnique; create: PostCreate };
  upsert: { create: PostCreate; update: PostUpdate };
}>;
export type CommentUpdateAuthorInput = OneOf<{
  update: UserUpdate;
  delete: true;
  connect: UserUnique;
  create: UserCreate;
  connectOrCreate: { where: UserUnique; create: UserCreate };
  upsert: { create: UserCreate; update: UserUpdate };
}>;
export type TagCreatePostsInput = AtLeastOne<{
  create: PostCreate | PostCreate[];
  connect: PostUnique | PostUnique[];
  connectOrCreate: { where: PostUnique; create: PostCreate } | { where: PostUnique; create: PostCreate }[];
}>;
export type TagUpdatePostsInput = AtLeastOne<{
  update: { where: PostUnique; data: PostUpdate } | { where: PostUnique; data: PostUpdate }[];
  delete: PostUnique | PostUnique[];
  connect: PostUnique | PostUnique[];
  create: PostCreate | PostCreate[];
  connectOrCreate: { where: PostUnique; create: PostCreate } | { where: PostUnique; create: PostCreate }[];
  upsert: { where: PostUnique; create: PostCreate; update: PostUpdate } | { where: PostUnique; create: PostCreate; update: PostUpdate }[];
  updateMany: { where?: Where<Models, "Post">; data: PostScalarUpdate } | { where?: Where<Models, "Post">; data: PostScalarUpdate }[];
  deleteMany: Where<Models, "Post"> | Where<Models, "Post">[];
  disconnect: PostUnique | PostUnique[];
  set: PostUnique[];
}>;
export type CategoryCreateParentInput = OneOf<{
  create: CategoryCreate;
  connect: CategoryUnique;
  connectOrCreate: { where: CategoryUnique; create: CategoryCreate };
}>;
export type CategoryCreateWithoutParent = DistributiveOmit<CategoryCreate, "parentId" | "parent">;
export type CategoryCreateChildrenInput = AtLeastOne<{
  create: CategoryCreateWithoutParent | CategoryCreateWithoutParent[];
  connect: CategoryUnique | CategoryUnique[];
  connectOrCreate: { where: CategoryUnique; create: CategoryCreateWithoutParent } | { where: CategoryUnique; create: CategoryCreateWithoutParent }[];
  createMany: {
    data: DistributiveOmit<CategoryScalarCreate, "parentId">[];
    skipDuplicates?: boolean;
  };
}>;
export type CategoryUpdateParentInput = OneOf<{
  update: CategoryUpdate;
  delete: true;
  connect: CategoryUnique;
  create: CategoryCreate;
  connectOrCreate: { where: CategoryUnique; create: CategoryCreate };
  upsert: { create: CategoryCreate; update: CategoryUpdate };
  disconnect: true;
}>;
export type CategoryUpdateChildrenInput = AtLeastOne<{
  update: { where: CategoryUnique; data: CategoryUpdate } | { where: CategoryUnique; data: CategoryUpdate }[];
  delete: CategoryUnique | CategoryUnique[];
  connect: CategoryUnique | CategoryUnique[];
  create: CategoryCreateWithoutParent | CategoryCreateWithoutParent[];
  connectOrCreate: { where: CategoryUnique; create: CategoryCreateWithoutParent } | { where: CategoryUnique; create: CategoryCreateWithoutParent }[];
  upsert: { where: CategoryUnique; create: CategoryCreateWithoutParent; update: CategoryUpdate } | { where: CategoryUnique; create: CategoryCreateWithoutParent; update: CategoryUpdate }[];
  updateMany: { where?: Where<Models, "Category">; data: CategoryScalarUpdate } | { where?: Where<Models, "Category">; data: CategoryScalarUpdate }[];
  deleteMany: Where<Models, "Category"> | Where<Models, "Category">[];
  createMany: {
    data: DistributiveOmit<CategoryScalarCreate, "parentId">[];
    skipDuplicates?: boolean;
  };
  disconnect: CategoryUnique | CategoryUnique[];
  set: CategoryUnique[];
}>;
export type EntryCreateWithoutAccount = DistributiveOmit<EntryCreate, "accountId" | "account">;
export type AccountCreateEntriesInput = AtLeastOne<{
  create: EntryCreateWithoutAccount | EntryCreateWithoutAccount[];
  connect: EntryUnique | EntryUnique[];
  connectOrCreate: { where: EntryUnique; create: EntryCreateWithoutAccount } | { where: EntryUnique; create: EntryCreateWithoutAccount }[];
  createMany: {
    data: DistributiveOmit<EntryScalarCreate, "accountId">[];
    skipDuplicates?: boolean;
  };
}>;
export type AccountUpdateEntriesInput = AtLeastOne<{
  update: { where: EntryUnique; data: EntryUpdate } | { where: EntryUnique; data: EntryUpdate }[];
  delete: EntryUnique | EntryUnique[];
  connect: EntryUnique | EntryUnique[];
  create: EntryCreateWithoutAccount | EntryCreateWithoutAccount[];
  connectOrCreate: { where: EntryUnique; create: EntryCreateWithoutAccount } | { where: EntryUnique; create: EntryCreateWithoutAccount }[];
  upsert: { where: EntryUnique; create: EntryCreateWithoutAccount; update: EntryUpdate } | { where: EntryUnique; create: EntryCreateWithoutAccount; update: EntryUpdate }[];
  updateMany: { where?: Where<Models, "Entry">; data: EntryScalarUpdate } | { where?: Where<Models, "Entry">; data: EntryScalarUpdate }[];
  deleteMany: Where<Models, "Entry"> | Where<Models, "Entry">[];
  createMany: {
    data: DistributiveOmit<EntryScalarCreate, "accountId">[];
    skipDuplicates?: boolean;
  };
  set: EntryUnique[];
}>;
export type EntryCreateAccountInput = OneOf<{
  create: AccountCreate;
  connect: AccountUnique;
  connectOrCreate: { where: AccountUnique; create: AccountCreate };
}>;
export type EntryUpdateAccountInput = OneOf<{
  update: AccountUpdate;
  delete: true;
  connect: AccountUnique;
  create: AccountCreate;
  connectOrCreate: { where: AccountUnique; create: AccountCreate };
  upsert: { create: AccountCreate; update: AccountUpdate };
}>;
type AtLeastOne<T> = { [K in keyof T]: Required<Pick<T, K>> & Partial<Omit<T, K>> }[keyof T];
type OneOf<T> = {
  [K in keyof T]: { [P in K]: T[P] } & { [P in Exclude<keyof T, K>]?: never };
}[keyof T];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Models = {
  User: {
    row: UserRow;
    create: UserCreate;
    update: UserUpdate;
    dateFields: "createdAt" | "updatedAt";
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: UserScalarCreate;
    scalarUpdate: UserScalarUpdate;
    unique: UserUnique;
    relations: {
      following: { target: "User"; many: true; nullable: false };
      posts: { target: "Post"; many: true; nullable: false };
      reviewed: { target: "Post"; many: true; nullable: false };
      profile: { target: "Profile"; many: false; nullable: true };
      comments: { target: "Comment"; many: true; nullable: false };
      followers: { target: "User"; many: true; nullable: false };
      attachments: { target: "Attachment"; many: true; nullable: false };
    };
  };
  Profile: {
    row: ProfileRow;
    create: ProfileCreate;
    update: ProfileUpdate;
    dateFields: never;
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: ProfileScalarCreate;
    scalarUpdate: ProfileScalarUpdate;
    unique: ProfileUnique;
    relations: { user: { target: "User"; many: false; nullable: false } };
  };
  Post: {
    row: PostRow;
    create: PostCreate;
    update: PostUpdate;
    dateFields: "createdAt";
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: PostScalarCreate;
    scalarUpdate: PostScalarUpdate;
    unique: PostUnique;
    relations: {
      author: { target: "User"; many: false; nullable: false };
      reviewer: { target: "User"; many: false; nullable: true };
      tags: { target: "Tag"; many: true; nullable: false };
      comments: { target: "Comment"; many: true; nullable: false };
      attachments: { target: "Attachment"; many: true; nullable: false };
      notes: { target: "Note"; many: true; nullable: false };
    };
  };
  Comment: {
    row: CommentRow;
    create: CommentCreate;
    update: CommentUpdate;
    dateFields: never;
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: CommentScalarCreate;
    scalarUpdate: CommentScalarUpdate;
    unique: CommentUnique;
    relations: {
      post: { target: "Post"; many: false; nullable: false };
      author: { target: "User"; many: false; nullable: false };
    };
  };
  Tag: {
    row: TagRow;
    create: TagCreate;
    update: TagUpdate;
    dateFields: never;
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: TagScalarCreate;
    scalarUpdate: TagScalarUpdate;
    unique: TagUnique;
    relations: { posts: { target: "Post"; many: true; nullable: false } };
  };
  Category: {
    row: CategoryRow;
    create: CategoryCreate;
    update: CategoryUpdate;
    dateFields: never;
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: CategoryScalarCreate;
    scalarUpdate: CategoryScalarUpdate;
    unique: CategoryUnique;
    relations: {
      parent: { target: "Category"; many: false; nullable: true };
      children: { target: "Category"; many: true; nullable: false };
    };
  };
  Membership: {
    row: MembershipRow;
    create: MembershipCreate;
    update: MembershipUpdate;
    dateFields: never;
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: MembershipScalarCreate;
    scalarUpdate: MembershipScalarUpdate;
    unique: MembershipUnique;
    relations: {};
  };
  Product: {
    row: ProductRow;
    create: ProductCreate;
    update: ProductUpdate;
    dateFields: never;
    bigintFields: "stock";
    decimalFields: "price";
    jsonFields: never;
    scalarCreate: ProductScalarCreate;
    scalarUpdate: ProductScalarUpdate;
    unique: ProductUnique;
    relations: {};
  };
  Slot: {
    row: SlotRow;
    create: SlotCreate;
    update: SlotUpdate;
    dateFields: never;
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: SlotScalarCreate;
    scalarUpdate: SlotScalarUpdate;
    unique: SlotUnique;
    relations: {};
  };
  Account: {
    row: AccountRow;
    create: AccountCreate;
    update: AccountUpdate;
    dateFields: "deletedAt";
    bigintFields: never;
    decimalFields: never;
    jsonFields: "settings";
    scalarCreate: AccountScalarCreate;
    scalarUpdate: AccountScalarUpdate;
    unique: AccountUnique;
    relations: { entries: { target: "Entry"; many: true; nullable: false } };
  };
  Entry: {
    row: EntryRow;
    create: EntryCreate;
    update: EntryUpdate;
    dateFields: "deletedAt";
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: EntryScalarCreate;
    scalarUpdate: EntryScalarUpdate;
    unique: EntryUnique;
    relations: { account: { target: "Account"; many: false; nullable: false } };
  };
  Attachment: {
    row: AttachmentRow;
    create: AttachmentCreate;
    update: AttachmentUpdate;
    dateFields: "deletedAt";
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: AttachmentScalarCreate;
    scalarUpdate: AttachmentScalarUpdate;
    unique: AttachmentUnique;
    relations: {};
  };
  Note: {
    row: NoteRow;
    create: NoteCreate;
    update: NoteUpdate;
    dateFields: never;
    bigintFields: never;
    decimalFields: never;
    jsonFields: never;
    scalarCreate: NoteScalarCreate;
    scalarUpdate: NoteScalarUpdate;
    unique: NoteUnique;
    relations: {};
  };
};
export const schema: Schema = {
  version: 1,
  tables: {
    User: {
      name: "User",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        email: {
          name: "email",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: true,
          maxLength: 191,
        },
        name: {
          name: "name",
          type: "string",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
          default: null,
        },
        role: {
          name: "role",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          enum: ["admin", "member"],
          maxLength: 191,
          default: "member",
        },
        age: {
          name: "age",
          type: "int",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
        createdAt: {
          name: "createdAt",
          type: "datetime",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          default: {
            fn: "now",
          },
        },
        updatedAt: {
          name: "updatedAt",
          type: "datetime",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          updatedAt: true,
        },
      },
      relations: {
        following: {
          name: "following",
          target: "User",
          many: true,
          nullable: false,
          owner: true,
          source: "id",
          foreign: "id",
          junction: "_User_following",
          junctionSource: "sourceId",
          junctionTarget: "targetId",
        },
        posts: {
          name: "posts",
          target: "Post",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "authorId",
        },
        reviewed: {
          name: "reviewed",
          target: "Post",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "reviewerId",
        },
        profile: {
          name: "profile",
          target: "Profile",
          many: false,
          nullable: true,
          owner: false,
          source: "id",
          foreign: "userId",
        },
        comments: {
          name: "comments",
          target: "Comment",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "authorId",
        },
        followers: {
          name: "followers",
          target: "User",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "id",
          junction: "_User_following",
          junctionSource: "targetId",
          junctionTarget: "sourceId",
        },
        attachments: {
          name: "attachments",
          target: "Attachment",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "ownerId",
          polymorphic: true,
          discriminator: "ownerType",
          discriminatorValue: "User",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
    },
    Profile: {
      name: "Profile",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        bio: {
          name: "bio",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
          default: "",
        },
        userId: {
          name: "userId",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: true,
        },
      },
      relations: {
        user: {
          name: "user",
          target: "User",
          many: false,
          nullable: false,
          owner: true,
          source: "userId",
          foreign: "id",
          onDelete: "Cascade",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
    },
    Post: {
      name: "Post",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        title: {
          name: "title",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 200,
        },
        content: {
          name: "content",
          type: "text",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
        published: {
          name: "published",
          type: "boolean",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          default: false,
        },
        views: {
          name: "views",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          default: 0,
        },
        rating: {
          name: "rating",
          type: "number",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
        createdAt: {
          name: "createdAt",
          type: "datetime",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          default: {
            fn: "now",
          },
        },
        authorId: {
          name: "authorId",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
        reviewerId: {
          name: "reviewerId",
          type: "int",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
      },
      relations: {
        author: {
          name: "author",
          target: "User",
          many: false,
          nullable: false,
          owner: true,
          source: "authorId",
          foreign: "id",
          onDelete: "Cascade",
        },
        reviewer: {
          name: "reviewer",
          target: "User",
          many: false,
          nullable: true,
          owner: true,
          source: "reviewerId",
          foreign: "id",
          onDelete: "SetNull",
        },
        tags: {
          name: "tags",
          target: "Tag",
          many: true,
          nullable: false,
          owner: true,
          source: "id",
          foreign: "id",
          junction: "_Post_tags",
          junctionSource: "sourceId",
          junctionTarget: "targetId",
        },
        comments: {
          name: "comments",
          target: "Comment",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "postId",
        },
        attachments: {
          name: "attachments",
          target: "Attachment",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "ownerId",
          polymorphic: true,
          discriminator: "ownerType",
          discriminatorValue: "Post",
        },
        notes: {
          name: "notes",
          target: "Note",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "holderId",
          polymorphic: true,
          discriminator: "holderType",
          discriminatorValue: "Post",
        },
      },
      primary: "id",
      unique: [],
      indexes: [["published"]],
    },
    Comment: {
      name: "Comment",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        body: {
          name: "body",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
        },
        postId: {
          name: "postId",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
        authorId: {
          name: "authorId",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
      },
      relations: {
        post: {
          name: "post",
          target: "Post",
          many: false,
          nullable: false,
          owner: true,
          source: "postId",
          foreign: "id",
          onDelete: "Cascade",
        },
        author: {
          name: "author",
          target: "User",
          many: false,
          nullable: false,
          owner: true,
          source: "authorId",
          foreign: "id",
          onDelete: "Cascade",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
    },
    Tag: {
      name: "Tag",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        name: {
          name: "name",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: true,
          maxLength: 64,
        },
      },
      relations: {
        posts: {
          name: "posts",
          target: "Post",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "id",
          junction: "_Post_tags",
          junctionSource: "targetId",
          junctionTarget: "sourceId",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
    },
    Category: {
      name: "Category",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        name: {
          name: "name",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 64,
        },
        parentId: {
          name: "parentId",
          type: "int",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
      },
      relations: {
        parent: {
          name: "parent",
          target: "Category",
          many: false,
          nullable: true,
          owner: true,
          source: "parentId",
          foreign: "id",
          onDelete: "SetNull",
        },
        children: {
          name: "children",
          target: "Category",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "parentId",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
    },
    Membership: {
      name: "Membership",
      columns: {
        organization: {
          name: "organization",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 64,
        },
        email: {
          name: "email",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
        },
        level: {
          name: "level",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          default: 1,
        },
      },
      relations: {},
      primary: "",
      unique: [],
      indexes: [],
      primaryKey: ["organization", "email"],
    },
    Product: {
      name: "Product",
      columns: {
        id: {
          name: "id",
          type: "string",
          nullable: false,
          primary: true,
          auto: false,
          unique: false,
          maxLength: 36,
          default: {
            fn: "uuid",
          },
        },
        sku: {
          name: "sku",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: true,
          maxLength: 32,
          map: "product_sku",
        },
        price: {
          name: "price",
          type: "decimal",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          precision: 10,
          scale: 2,
        },
        stock: {
          name: "stock",
          type: "bigint",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          default: 0,
        },
        payload: {
          name: "payload",
          type: "bytes",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
        active: {
          name: "active",
          type: "boolean",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          default: true,
        },
      },
      relations: {},
      primary: "id",
      unique: [],
      indexes: [],
      map: "products",
    },
    Slot: {
      name: "Slot",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        owner: {
          name: "owner",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 64,
        },
        slot: {
          name: "slot",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
      },
      relations: {},
      primary: "id",
      unique: [["owner", "slot"]],
      indexes: [],
    },
    Account: {
      name: "Account",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        email: {
          name: "email",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: true,
          maxLength: 191,
        },
        name: {
          name: "name",
          type: "string",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
          default: null,
        },
        settings: {
          name: "settings",
          type: "json",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          json: {
            root: {
              kind: "ref",
              name: "Settings",
            },
            definitions: {
              Settings: {
                kind: "object",
                fields: {
                  theme: {
                    optional: false,
                    shape: {
                      kind: "union",
                      items: [
                        {
                          kind: "literal",
                          value: "light",
                        },
                        {
                          kind: "literal",
                          value: "dark",
                        },
                      ],
                    },
                  },
                  notifications: {
                    optional: false,
                    shape: {
                      kind: "primitive",
                      name: "boolean",
                    },
                  },
                  tags: {
                    optional: false,
                    shape: {
                      kind: "array",
                      element: {
                        kind: "primitive",
                        name: "string",
                      },
                    },
                  },
                  score: {
                    optional: true,
                    shape: {
                      kind: "primitive",
                      name: "number",
                    },
                  },
                },
              },
            },
          },
          default: null,
        },
        deletedAt: {
          name: "deletedAt",
          type: "datetime",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
      },
      relations: {
        entries: {
          name: "entries",
          target: "Entry",
          many: true,
          nullable: false,
          owner: false,
          source: "id",
          foreign: "accountId",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
      softDelete: "deletedAt",
    },
    Entry: {
      name: "Entry",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        title: {
          name: "title",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
        },
        deletedAt: {
          name: "deletedAt",
          type: "datetime",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
        accountId: {
          name: "accountId",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
      },
      relations: {
        account: {
          name: "account",
          target: "Account",
          many: false,
          nullable: false,
          owner: true,
          source: "accountId",
          foreign: "id",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
      softDelete: "deletedAt",
    },
    Attachment: {
      name: "Attachment",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        name: {
          name: "name",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
        },
        ownerType: {
          name: "ownerType",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          enum: ["Post", "User"],
          maxLength: 191,
        },
        ownerId: {
          name: "ownerId",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
        deletedAt: {
          name: "deletedAt",
          type: "datetime",
          nullable: true,
          primary: false,
          auto: false,
          unique: false,
          default: null,
        },
      },
      relations: {
        owner: {
          name: "owner",
          target: "",
          many: false,
          nullable: false,
          owner: true,
          source: "ownerId",
          foreign: "",
          polymorphic: true,
          discriminator: "ownerType",
        },
      },
      primary: "id",
      unique: [],
      indexes: [],
      softDelete: "deletedAt",
    },
    Note: {
      name: "Note",
      columns: {
        id: {
          name: "id",
          type: "int",
          nullable: false,
          primary: true,
          auto: true,
          unique: false,
        },
        body: {
          name: "body",
          type: "string",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
          maxLength: 191,
        },
        holderType: {
          name: "holderType",
          type: "string",
          maxLength: 191,
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
        holderId: {
          name: "holderId",
          type: "int",
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
      },
      relations: {
        holder: {
          name: "holder",
          target: "",
          many: false,
          nullable: false,
          owner: true,
          source: "holderId",
          foreign: "",
          polymorphic: true,
          discriminator: "holderType",
        },
      },
      primary: "id",
      unique: [],
      indexes: [["holderType", "holderId"]],
    },
  },
  jsonTypes: {
    Settings: {
      kind: "object",
      fields: {
        theme: {
          optional: false,
          shape: {
            kind: "union",
            items: [
              {
                kind: "literal",
                value: "light",
              },
              {
                kind: "literal",
                value: "dark",
              },
            ],
          },
        },
        notifications: {
          optional: false,
          shape: {
            kind: "primitive",
            name: "boolean",
          },
        },
        tags: {
          optional: false,
          shape: {
            kind: "array",
            element: {
              kind: "primitive",
              name: "string",
            },
          },
        },
        score: {
          optional: true,
          shape: {
            kind: "primitive",
            name: "number",
          },
        },
      },
    },
  },
};
export const createClient = (options: ClientOptions) => {
  return createORMClient<Models>(schema, options);
};
