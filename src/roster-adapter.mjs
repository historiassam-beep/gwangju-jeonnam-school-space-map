export const SCHOOL_TYPE_NAMES = Object.freeze({
  '02': '초등학교',
  '03': '중학교',
  '04': '고등학교',
  '05': '특수학교',
  '06': '그외학교',
  '07': '각종학교',
});

export async function loadV15Data(baseUrl = '.') {
  const root = baseUrl.replace(/\/$/, '');
  const [schools, summary, opening, evidence] = await Promise.all([
    fetch(`${root}/data/verified-current-schools.json`).then(assertOk).then((r) => r.json()),
    fetch(`${root}/data/comparison-summary.json`).then(assertOk).then((r) => r.json()),
    fetch(`${root}/data/schoolinfo-facility-opening-2026.json`).then(assertOk).then((r) => r.json()),
    fetch(`${root}/data/official-status-evidence.json`).then(assertOk).then((r) => r.json()),
  ]);
  validateRoster(schools);
  const connected = attachOfficialEvidence(attachOpeningData(schools, opening.records), evidence.records);
  return { schools: connected, summary, openingMetadata: opening.metadata,
    verifiedClosures: evidence.records.filter(record => record.kind === 'verified_closure'), indexes: createIndexes(connected) };
}

export const OPENING_FIELDS = Object.freeze(['playground', 'gym', 'auditorium']);
export function attachOfficialEvidence(schools, records) {
  if (!Array.isArray(records)) throw new TypeError('공식 상태 근거는 배열이어야 합니다.');
  const byCode = new Map();
  for (const record of records) {
    if (!record.schoolinfoCode || byCode.has(record.schoolinfoCode)) throw new Error(`공식 상태 근거 학교코드 오류: ${record.schoolinfoCode}`);
    byCode.set(record.schoolinfoCode, record);
  }
  return schools.map(school => ({ ...school, officialStatusEvidence: byCode.get(school.schoolinfoCode) ?? null }));
}
export function attachOpeningData(schools, records) {
  if (!Array.isArray(records)) throw new TypeError('시설 개방 공시 행은 배열이어야 합니다.');
  const byCode = new Map();
  for (const record of records) {
    if (!record.schoolinfoCode || byCode.has(record.schoolinfoCode)) throw new Error(`시설 개방 공시 학교코드 오류: ${record.schoolinfoCode}`);
    byCode.set(record.schoolinfoCode, record);
  }
  return schools.map(school => ({ ...school, opening: byCode.get(school.schoolinfoCode) ?? null }));
}

export function openingStatus(school, field) {
  if (!OPENING_FIELDS.includes(field)) throw new Error(`알 수 없는 시설 종류: ${field}`);
  if (!school?.opening) return 'unconfirmed';
  if (school.opening.excluded) return 'excluded';
  return ({ '유': 'open', '무': 'closed', '시설없음': 'none' })[school.opening[field]] ?? 'unconfirmed';
}

function assertOk(response) {
  if (!response.ok) throw new Error(`데이터를 불러오지 못했습니다: ${response.status} ${response.url}`);
  return response;
}

export function validateRoster(schools) {
  if (!Array.isArray(schools)) throw new TypeError('학교 명부는 배열이어야 합니다.');
  const ids = new Set();
  for (const school of schools) {
    for (const field of ['baselineId', 'schoolName', 'schoolTypeCode', 'region']) {
      if (!school[field]) throw new Error(`${field} 값이 없는 학교가 있습니다.`);
    }
    if (ids.has(school.baselineId)) throw new Error(`중복 baselineId: ${school.baselineId}`);
    ids.add(school.baselineId);
    if (!(school.schoolTypeCode in SCHOOL_TYPE_NAMES)) throw new Error(`알 수 없는 학교급 코드: ${school.schoolTypeCode}`);
    if (!['광주', '전남'].includes(school.region)) throw new Error(`알 수 없는 권역: ${school.region}`);
  }
  return true;
}

export function createIndexes(schools) {
  const byBaselineId = new Map();
  const byKediCode = new Map();
  const bySchoolinfoCode = new Map();
  for (const school of schools) {
    byBaselineId.set(school.baselineId, school);
    if (school.kediCode) byKediCode.set(school.kediCode, school);
    if (school.schoolinfoCode) bySchoolinfoCode.set(school.schoolinfoCode, school);
  }
  return { byBaselineId, byKediCode, bySchoolinfoCode };
}

export function filterSchools(schools, filters = {}) {
  const query = String(filters.query || '').replace(/\s+/g, '').toLowerCase();
  return schools.filter((school) => {
    if (filters.region && school.region !== filters.region) return false;
    if (filters.schoolTypeCode && school.schoolTypeCode !== filters.schoolTypeCode) return false;
    if (filters.sourceMembership && school.sourceMembership !== filters.sourceMembership) return false;
    if (query) {
      const haystack = [school.schoolName, school.sigun, school.address, school.kediCode, school.schoolinfoCode]
        .filter(Boolean).join('').replace(/\s+/g, '').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function verifiedFacilityCount(school) {
  const facility = school && school.facility;
  if (!facility || facility.identityVerified !== true || facility.includedInFacilityAggregate !== true) return null;
  return Number.isFinite(facility.verifiedDistinctFacilityCount) ? facility.verifiedDistinctFacilityCount : null;
}

