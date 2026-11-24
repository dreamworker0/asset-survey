/**
 * OrgDocumentViewer — 기관 증빙서류 표시 (superAdmin 심사 화면 전용)
 *
 * 증빙서류는 영구 URL 없이 Storage 경로만 저장되므로(2026-07-18 보안 재검증 P0-3),
 * 이 컴포넌트가 표시 시점에 getOrgDocumentUrl 콜러블로 단기 서명 URL을 발급받아
 * DocumentViewer에 넘긴다.
 */
import { useEffect, useState } from 'react';
import DocumentViewer from '../common/DocumentViewer';
import { fetchOrgDocumentUrl } from '../../lib/orgDocument';

interface OrgDocumentViewerProps {
    orgId: string;
    /** 클릭 이벤트 전파 차단 여부 (아코디언 내부 등) */
    stopPropagation?: boolean;
}

export default function OrgDocumentViewer({ orgId, stopPropagation }: OrgDocumentViewerProps) {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);
    // 다시 시도를 누를 때마다 올려 서명 URL을 새로 받는다
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        setUrl(null);
        setError(false);
        fetchOrgDocumentUrl(orgId)
            .then((signedUrl) => { if (active) setUrl(signedUrl); })
            .catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [orgId, attempt]);

    if (error) {
        return (
            <div className="mt-2" role="alert">
                <p className="text-xs text-red-700 dark:text-red-300">증빙서류를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
                <button
                    type="button"
                    onClick={() => setAttempt(n => n + 1)}
                    className="btn-secondary btn-sm min-h-[48px] mt-2"
                >
                    다시 시도
                </button>
            </div>
        );
    }
    if (!url) {
        return <p className="mt-2 text-xs text-surface-600 dark:text-surface-400" role="status">증빙서류 불러오는 중…</p>;
    }
    return <DocumentViewer url={url} stopPropagation={stopPropagation} />;
}
