import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const supabase = await createClient();

  try {
    // --------------------------------------------------
    // 1. Verify authentication
    // --------------------------------------------------
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Authentication required.",
        },
        { status: 401 }
      );
    }

    // --------------------------------------------------
    // 2. Get user's organization
    // --------------------------------------------------
    const { data: profile, error: profileError } =
      await supabase
        .from("users")
        .select("organization_id")
        .eq("id", user.id)
        .single();

    if (profileError || !profile?.organization_id) {
      return NextResponse.json(
        {
          error: "Organization profile not found.",
        },
        { status: 403 }
      );
    }

    const organizationId = profile.organization_id;

    // --------------------------------------------------
    // 3. Get document ID
    // --------------------------------------------------
    const { id: documentId } = await context.params;

    if (!documentId) {
      return NextResponse.json(
        {
          error: "Document ID is required.",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 4. Retrieve document ONLY from user's organization
    // --------------------------------------------------
    const { data: document, error: documentError } =
      await supabase
        .from("documents")
        .select(
          "id, organization_id, filename, storage_path"
        )
        .eq("id", documentId)
        .eq("organization_id", organizationId)
        .single();

    if (
      documentError ||
      !document ||
      document.organization_id !== organizationId
    ) {
      return NextResponse.json(
        {
          error: "Document not found or access denied.",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 5. Verify storage path exists
    // --------------------------------------------------
    if (!document.storage_path) {
      return NextResponse.json(
        {
          error: "This document has no stored file.",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 6. Generate short-lived signed URL
    // --------------------------------------------------
    const { data: signedUrl, error: signedUrlError } =
      await supabase.storage
        .from("knowledge")
        .createSignedUrl(
          document.storage_path,
          60,
          {
            download: document.filename || true,
          }
        );

    if (signedUrlError || !signedUrl?.signedUrl) {
      console.error(
        "SIGNED URL ERROR:",
        signedUrlError
      );

      return NextResponse.json(
        {
          error: "Unable to generate document download.",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 7. Redirect to temporary signed URL
    // --------------------------------------------------
    return NextResponse.redirect(signedUrl.signedUrl);
  } catch (error: unknown) {
    console.error(
      "DOCUMENT DOWNLOAD ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Document download failed.",
      },
      { status: 500 }
    );
  }
}