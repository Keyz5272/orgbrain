import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isBrowserViewable(
  filename: string | null,
  mimeType: string | null
) {
  const mime = (mimeType || "").toLowerCase();

  if (
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime === "text/plain" ||
    mime === "text/csv" ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "text/xml"
  ) {
    return true;
  }

  const name = (filename || "").toLowerCase();

  const viewableExtensions = [
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

  return viewableExtensions.some((extension) =>
    name.endsWith(extension)
  );
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Source ID is required.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // --------------------------------------------------
    // AUTHENTICATION
    // --------------------------------------------------
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        { status: 401 }
      );
    }

    // --------------------------------------------------
    // GET USER ORGANIZATION
    // --------------------------------------------------
    const { data: profile, error: profileError } =
      await supabase
        .from("users")
        .select("organization_id")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError || !profile?.organization_id) {
      return NextResponse.json(
        {
          success: false,
          error: "User organization could not be determined.",
        },
        { status: 403 }
      );
    }

    const organizationId = profile.organization_id;

    // --------------------------------------------------
    // GET SOURCE - ORG SCOPED
    // --------------------------------------------------
    const { data: source, error: sourceError } =
      await supabase
        .from("knowledge_sources")
        .select(
          `
            id,
            organization_id,
            filename,
            mime_type,
            storage_path,
            source_type
          `
        )
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle();

    if (sourceError) {
      console.error(
        "Knowledge source lookup error:",
        sourceError
      );

      return NextResponse.json(
        {
          success: false,
          error: "Unable to retrieve source.",
        },
        { status: 500 }
      );
    }

    // Deliberately return the same response whether the
    // source doesn't exist or belongs to another organization.
    if (!source) {
      return NextResponse.json(
        {
          success: false,
          error: "Source not found.",
        },
        { status: 404 }
      );
    }

    if (!source.storage_path) {
      return NextResponse.json(
        {
          success: false,
          error: "This source has no stored file.",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // NON-BROWSER FILES
    // --------------------------------------------------
    if (
      !isBrowserViewable(
        source.filename,
        source.mime_type
      )
    ) {
      const downloadUrl = new URL(
        `/api/knowledge/sources/${source.id}/download`,
        request.url
      );

      return NextResponse.redirect(downloadUrl);
    }

    // --------------------------------------------------
    // SIGNED URL
    // --------------------------------------------------
    const { data: signedUrl, error: signedUrlError } =
      await supabase.storage
        .from("knowledge")
        .createSignedUrl(
          source.storage_path,
          60
        );

    if (signedUrlError || !signedUrl?.signedUrl) {
      console.error(
        "Signed URL error:",
        signedUrlError
      );

      return NextResponse.json(
        {
          success: false,
          error: "Unable to open source file.",
        },
        { status: 500 }
      );
    }

    return NextResponse.redirect(
      signedUrl.signedUrl
    );
  } catch (error) {
    console.error(
      "Knowledge source open error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred.",
      },
      { status: 500 }
    );
  }
}