import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BROWSER_VIEWABLE_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".txt",
  ".csv",
  ".json",
  ".xml",
];

function isBrowserViewable(filename: string) {
  const lower = filename.toLowerCase();

  return BROWSER_VIEWABLE_EXTENSIONS.some((extension) =>
    lower.endsWith(extension)
  );
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const supabase = await createClient();

  try {
    // ---------------------------------------------
    // 1. Authenticate
    // ---------------------------------------------
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    // ---------------------------------------------
    // 2. Get user's organization
    // ---------------------------------------------
    const { data: profile, error: profileError } =
      await supabase
        .from("users")
        .select("organization_id")
        .eq("id", user.id)
        .single();

    if (profileError || !profile?.organization_id) {
      return NextResponse.json(
        { error: "Organization profile not found." },
        { status: 403 }
      );
    }

    const organizationId = profile.organization_id;

    // ---------------------------------------------
    // 3. Get document ID
    // ---------------------------------------------
    const { id: documentId } = await context.params;

    if (!documentId) {
      return NextResponse.json(
        { error: "Document ID is required." },
        { status: 400 }
      );
    }

    // ---------------------------------------------
    // 4. Verify document belongs to organization
    // ---------------------------------------------
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
        { error: "Document not found or access denied." },
        { status: 404 }
      );
    }

    // ---------------------------------------------
    // 5. Check storage path
    // ---------------------------------------------
    if (!document.storage_path) {
      return NextResponse.json(
        { error: "This document has no stored file." },
        { status: 404 }
      );
    }

    const filename = document.filename || "document";

    // ---------------------------------------------
    // 6. Non-browser files
    // ---------------------------------------------
    // Word/Excel/etc. cannot normally be displayed
    // directly by the browser.
    //
    // Send them through the download route.
    // ---------------------------------------------
    if (!isBrowserViewable(filename)) {
      const url = new URL(
        `/api/knowledge/documents/${documentId}/download`,
        request.url
      );

      return NextResponse.redirect(url);
    }

    // ---------------------------------------------
    // 7. Browser-viewable file
    // ---------------------------------------------
    const { data: signedUrl, error: signedUrlError } =
      await supabase.storage
        .from("knowledge")
        .createSignedUrl(
          document.storage_path,
          60
        );

    if (signedUrlError || !signedUrl?.signedUrl) {
      console.error(
        "OPEN SOURCE SIGNED URL ERROR:",
        signedUrlError
      );

      return NextResponse.json(
        { error: "Unable to open document." },
        { status: 500 }
      );
    }

    // Browser-viewable formats are opened directly.
    return NextResponse.redirect(signedUrl.signedUrl);
  } catch (error: unknown) {
    console.error("OPEN DOCUMENT ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to open document.",
      },
      { status: 500 }
    );
  }
}