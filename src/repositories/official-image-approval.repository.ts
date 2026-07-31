import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOfficialImageApprovalExecution,
  type OfficialImageApprovalProposal,
} from "../domain/official-image-approval";

type CurrentImage = {
  standard_product_id: string;
  source_type: "upload" | "external_url";
  image_url: string;
};

type ApprovalLedger = {
  id: string;
  idempotency_key: string;
  target_fingerprint: string;
  standard_product_id: string;
  catalog_product_id: string;
  image_url: string;
  content_hash: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  byte_length: number;
  applied_action: "created" | "reused_exact";
};

type RpcResult = {
  approval_id: string;
  standard_product_id: string;
  catalog_product_id: string;
  replayed: boolean;
  applied_action: "created" | "reused_exact";
};

export type OfficialImageApprovalResult = {
  approvalId: string;
  standardProductId: string;
  catalogProductId: string;
  imageUrl: string;
  targetFingerprint: string;
  replayed: boolean;
  appliedAction: "created" | "reused_exact";
};

function errorMessage(reason: unknown, fallback: string) {
  return reason && typeof reason === "object" && "message" in reason
    ? String(reason.message)
    : fallback;
}

function isExactApprovedReplay(
  proposal: OfficialImageApprovalProposal,
  idempotencyKey: string,
  currentImage: CurrentImage | null,
  currentApproval: ApprovalLedger | null,
) {
  const image = proposal.officialListing.image;
  if (!image || !currentImage || !currentApproval) return false;
  return currentImage.source_type === "external_url"
    && currentImage.image_url === image.url
    && currentApproval.idempotency_key === idempotencyKey
    && currentApproval.target_fingerprint === proposal.approval.targetFingerprint
    && currentApproval.standard_product_id === proposal.decision.standardProductId
    && currentApproval.catalog_product_id === proposal.decision.catalogProductId
    && currentApproval.image_url === image.url
    && currentApproval.content_hash === image.contentHash
    && currentApproval.media_type === image.mediaType
    && currentApproval.byte_length === image.byteLength;
}

export async function applyApprovedOfficialImage(
  client: SupabaseClient,
  rawProposal: unknown,
): Promise<OfficialImageApprovalResult> {
  const execution = await buildOfficialImageApprovalExecution(rawProposal);
  const proposal = execution.proposal;
  const standardProductId = execution.rpcArgs.p_standard_product_id;
  const targetFingerprint = proposal.approval.targetFingerprint;
  const representativeImage = proposal.representativeImage;
  if (!representativeImage) throw new Error("공식 대표 이미지 대상이 없습니다.");

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw new Error(errorMessage(userError, "로그인 사용자를 확인하지 못했습니다."));
  if (userData.user?.app_metadata?.role !== "admin") {
    throw new Error("관리자 계정만 승인된 제안서를 실행할 수 있습니다.");
  }

  const [imageRead, approvalRead] = await Promise.all([
    client
      .from("standard_product_images")
      .select("standard_product_id,source_type,image_url")
      .eq("standard_product_id", standardProductId)
      .maybeSingle(),
    client
      .from("standard_product_official_image_approvals")
      .select("id,idempotency_key,target_fingerprint,standard_product_id,catalog_product_id,image_url,content_hash,media_type,byte_length,applied_action")
      .eq("target_fingerprint", targetFingerprint)
      .maybeSingle(),
  ]);
  if (imageRead.error) throw new Error(errorMessage(imageRead.error, "현재 대표 이미지를 확인하지 못했습니다."));
  if (approvalRead.error) throw new Error(errorMessage(approvalRead.error, "현재 이미지 승인 원장을 확인하지 못했습니다."));

  const currentImage = imageRead.data as CurrentImage | null;
  const currentApproval = approvalRead.data as ApprovalLedger | null;
  const exactReplay = isExactApprovedReplay(
    proposal,
    execution.rpcArgs.p_idempotency_key,
    currentImage,
    currentApproval,
  );
  if (representativeImage.action === "create" && currentImage && !exactReplay) {
    throw new Error("승인 이후 다른 대표 이미지가 생겨 실행을 중단했습니다. 덮어쓰지 않습니다.");
  }
  if (
    representativeImage.action === "reuse_exact"
    && (currentImage?.source_type !== "external_url"
      || currentImage.image_url !== representativeImage.imageUrl)
  ) {
    throw new Error("승인된 기존 대표 이미지와 현재 이미지가 달라 실행을 중단했습니다.");
  }

  const { data: rpcData, error: rpcError } = await client.rpc(
    "approve_standard_product_official_image_v1",
    execution.rpcArgs,
  );
  if (rpcError) throw new Error(errorMessage(rpcError, "공식 이미지 승인 RPC 실행에 실패했습니다."));
  const rpcResult = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as RpcResult | null;
  if (!rpcResult) throw new Error("공식 이미지 승인 RPC가 결과를 반환하지 않았습니다.");

  const [verifiedImageRead, verifiedApprovalRead] = await Promise.all([
    client
      .from("standard_product_images")
      .select("standard_product_id,source_type,image_url")
      .eq("standard_product_id", standardProductId)
      .maybeSingle(),
    client
      .from("standard_product_official_image_approvals")
      .select("id,idempotency_key,target_fingerprint,standard_product_id,catalog_product_id,image_url,content_hash,media_type,byte_length,applied_action")
      .eq("id", rpcResult.approval_id)
      .single(),
  ]);
  if (verifiedImageRead.error) throw new Error(errorMessage(verifiedImageRead.error, "적용된 대표 이미지를 재검증하지 못했습니다."));
  if (verifiedApprovalRead.error) throw new Error(errorMessage(verifiedApprovalRead.error, "적용된 승인 원장을 재검증하지 못했습니다."));

  const verifiedImage = verifiedImageRead.data as CurrentImage | null;
  const verifiedApproval = verifiedApprovalRead.data as ApprovalLedger | null;
  const image = proposal.officialListing.image;
  if (
    !image
    || verifiedImage?.standard_product_id !== standardProductId
    || verifiedImage.source_type !== "external_url"
    || verifiedImage.image_url !== image.url
    || !verifiedApproval
    || verifiedApproval.id !== rpcResult.approval_id
    || verifiedApproval.idempotency_key !== execution.rpcArgs.p_idempotency_key
    || verifiedApproval.target_fingerprint !== targetFingerprint
    || verifiedApproval.standard_product_id !== rpcResult.standard_product_id
    || verifiedApproval.catalog_product_id !== rpcResult.catalog_product_id
    || verifiedApproval.image_url !== image.url
    || verifiedApproval.content_hash !== image.contentHash
    || verifiedApproval.media_type !== image.mediaType
    || verifiedApproval.byte_length !== image.byteLength
    || verifiedApproval.applied_action !== rpcResult.applied_action
  ) {
    throw new Error("RPC 결과와 운영 DB의 이미지 또는 승인 원장이 일치하지 않습니다.");
  }

  return {
    approvalId: rpcResult.approval_id,
    standardProductId: rpcResult.standard_product_id,
    catalogProductId: rpcResult.catalog_product_id,
    imageUrl: image.url,
    targetFingerprint,
    replayed: rpcResult.replayed,
    appliedAction: rpcResult.applied_action,
  };
}
