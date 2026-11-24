/**
 * useSettingsModals — Settings 페이지의 모달 표시 상태 묶음
 * 건의/서비스 해지/도움말 모달의 on/off 상태만 관리하는 순수 UI 훅.
 */
import { useState } from 'react';

export default function useSettingsModals() {
    const [showFeedback, setShowFeedback] = useState(false);
    const [showWithdraw, setShowWithdraw] = useState(false);
    const [showHelp, setShowHelp] = useState(false);

    return {
        showFeedback, setShowFeedback,
        showWithdraw, setShowWithdraw,
        showHelp, setShowHelp,
    };
}
