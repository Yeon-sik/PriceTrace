"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { RestaurantProfileEditor } from "@/domain/restaurant-menu";
import { RestaurantMenuRepository } from "@/repositories/restaurant-menu.repository";
import styles from "./page.module.css";

type ProfileForm = {
  restaurantId: string;
  restaurantLocationId: string;
  canonicalName: string;
  legalName: string;
  cuisineType: string;
  officialSiteUrl: string;
  locationLabel: string;
  locationOfficialUrl: string;
  businessRegistrationNumber: string;
  address: string;
  phone: string;
  sourceUrl: string;
};

const emptyForm: ProfileForm = {
  restaurantId: "",
  restaurantLocationId: "",
  canonicalName: "",
  legalName: "",
  cuisineType: "",
  officialSiteUrl: "",
  locationLabel: "",
  locationOfficialUrl: "",
  businessRegistrationNumber: "",
  address: "",
  phone: "",
  sourceUrl: "",
};

function nullable(value: string) {
  return value.trim() || null;
}

function locationLabel(profile: RestaurantProfileEditor, locationId: string) {
  const location = profile.locations.find((entry) => entry.id === locationId);
  if (!location) return "";
  return `${location.locationLabel ?? "지점 표기 없음"} · ${location.sourceLabel}:${location.sourceRestaurantCode}`;
}

function profileToForm(profile: RestaurantProfileEditor, locationId?: string): ProfileForm {
  const location = profile.locations.find((entry) => entry.id === locationId) ?? profile.locations[0];
  return {
    restaurantId: profile.id,
    restaurantLocationId: location?.id ?? "",
    canonicalName: profile.canonicalName,
    legalName: profile.legalName ?? "",
    cuisineType: profile.cuisineType ?? "",
    officialSiteUrl: profile.officialSiteUrl ?? "",
    locationLabel: location?.locationLabel ?? "",
    locationOfficialUrl: location?.officialUrl ?? "",
    businessRegistrationNumber: location?.businessRegistrationNumber ?? "",
    address: location?.address ?? "",
    phone: location?.phone ?? "",
    sourceUrl: location?.profileSourceUrl ?? "",
  };
}

export function AdminRestaurantProfileEditor({ repository }: { repository: RestaurantMenuRepository }) {
  const [profiles, setProfiles] = useState<RestaurantProfileEditor[]>([]);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === form.restaurantId) ?? null,
    [form.restaurantId, profiles],
  );
  const selectedLocation = selectedProfile?.locations.find((location) => location.id === form.restaurantLocationId) ?? null;

  const load = useCallback(async (selectedId?: string, selectedLocationId?: string) => {
    setLoading(true);
    try {
      const nextProfiles = await repository.readAdminRestaurantProfileEditors();
      setProfiles(nextProfiles);
      const profile = nextProfiles.find((entry) => entry.id === selectedId) ?? nextProfiles[0] ?? null;
      setForm(profile ? profileToForm(profile, selectedLocationId) : emptyForm);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음식점 프로필 편집 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => { void load(); }, [load]);

  function chooseProfile(restaurantId: string) {
    const profile = profiles.find((entry) => entry.id === restaurantId) ?? null;
    setForm(profile ? profileToForm(profile) : emptyForm);
    setMessage("");
    setError("");
  }

  function chooseLocation(restaurantLocationId: string) {
    if (!selectedProfile) return;
    setForm(profileToForm(selectedProfile, restaurantLocationId));
    setMessage("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile || !selectedLocation) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await repository.updateAdminRestaurantProfileEditor({
        restaurantId: form.restaurantId,
        restaurantLocationId: form.restaurantLocationId,
        canonicalName: form.canonicalName,
        legalName: nullable(form.legalName),
        cuisineType: nullable(form.cuisineType),
        officialSiteUrl: nullable(form.officialSiteUrl),
        locationLabel: nullable(form.locationLabel),
        locationOfficialUrl: nullable(form.locationOfficialUrl),
        businessRegistrationNumber: nullable(form.businessRegistrationNumber),
        address: nullable(form.address),
        phone: nullable(form.phone),
        sourceUrl: form.sourceUrl.trim(),
      });
      await load(form.restaurantId, form.restaurantLocationId);
      setMessage("프로필을 저장했습니다. 입력한 값과 수정 전후 상태가 관리자 감사 이력에 남았습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음식점 프로필을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.restaurantProfileEditor} aria-labelledby="restaurant-profile-editor-title">
    <div className={styles.restaurantProfileEditorHead}>
      <div>
        <h3 id="restaurant-profile-editor-title">가게 프로필 수정</h3>
        <p>상호·지점 정보와 사업자등록번호·주소·전화번호를 정확한 지점에만 등록합니다. 영수증 원본과 source identity는 수정하지 않습니다.</p>
      </div>
      <button type="button" onClick={() => void load(form.restaurantId, form.restaurantLocationId)} disabled={loading || saving}>새로고침</button>
    </div>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.restaurantAdminSuccess} role="status">{message}</p>}

    {loading ? <p className={styles.restaurantAdminHint}>관리자 프로필을 불러오는 중입니다.</p> : profiles.length === 0 ? <p className={styles.restaurantAdminHint}>수정 가능한 활성 음식점이 없습니다.</p> : <form className={styles.restaurantProfileEditorForm} onSubmit={(event) => void submit(event)}>
      <label>음식점<select value={form.restaurantId} onChange={(event) => chooseProfile(event.target.value)} disabled={saving}>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.canonicalName}</option>)}
      </select></label>
      <label>정확한 지점<select value={form.restaurantLocationId} onChange={(event) => chooseLocation(event.target.value)} disabled={saving || !selectedProfile}>
        {selectedProfile?.locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(selectedProfile, location.id)}</option>)}
      </select></label>
      <p className={styles.restaurantProfileEditorIdentity}>source identity: <code>{selectedLocation ? `${selectedLocation.sourceLabel}:${selectedLocation.sourceRestaurantCode}` : "정보 없음"}</code></p>

      <label>표시 상호<input required value={form.canonicalName} onChange={(event) => setForm({ ...form, canonicalName: event.target.value })} disabled={saving} /></label>
      <label>법적 상호<input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} disabled={saving} /></label>
      <label>업종<input value={form.cuisineType} onChange={(event) => setForm({ ...form, cuisineType: event.target.value })} disabled={saving} /></label>
      <label>식당 공식 사이트<input type="url" value={form.officialSiteUrl} onChange={(event) => setForm({ ...form, officialSiteUrl: event.target.value })} placeholder="https://" disabled={saving} /></label>
      <label>지점 표기<input value={form.locationLabel} onChange={(event) => setForm({ ...form, locationLabel: event.target.value })} disabled={saving} /></label>
      <label>지점 공식 URL<input type="url" value={form.locationOfficialUrl} onChange={(event) => setForm({ ...form, locationOfficialUrl: event.target.value })} placeholder="https://" disabled={saving} /></label>

      <fieldset>
        <legend>지점 연락처·사업자 정보</legend>
        <label>사업자등록번호<input inputMode="numeric" value={form.businessRegistrationNumber} onChange={(event) => setForm({ ...form, businessRegistrationNumber: event.target.value })} placeholder="000-00-00000" disabled={saving} /></label>
        <label>주소<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} disabled={saving} /></label>
        <label>전화번호<input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} disabled={saving} /></label>
      </fieldset>

      <label className={styles.restaurantProfileEditorEvidence}>수정 근거 URL<input required type="url" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="공식 페이지 또는 확인 가능한 출처 URL" disabled={saving} /><small>모든 저장에는 근거 URL이 필요합니다. 번호가 없는 영수증은 비워 두세요.</small></label>
      <button type="submit" disabled={saving || !selectedLocation}>{saving ? "저장 중…" : "가게 프로필 저장"}</button>
    </form>}
  </section>;
}
