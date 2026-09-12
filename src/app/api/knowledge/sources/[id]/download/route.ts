import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
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
    // CREATE DOWNLOAD SIGNED URL
    // --------------------------------------------------
    const { data: signedUrl, error: signedUrlError } =
      await supabase.storage
        .from("knowledge")
        .createSignedUrl(
          source.storage_path,
          60,
          {
            download:
              source.filename || true,
          }
        );

    if (signedUrlError || !signedUrl?.signedUrl) {
      console.error(
        "Download signed URL error:",
        signedUrlError
      );

      return NextResponse.json(
        {
          success: false,
          error: "Unable to download source file.",
        },
        { status: 500 }
      );
    }

    return NextResponse.redirect(
      signedUrl.signedUrl
    );
  } catch (error) {
    console.error(
      "Knowledge source download error:",
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