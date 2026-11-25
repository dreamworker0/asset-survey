/**
 * PanelModal — 공용 Modal 래퍼 (기존 import 경로 호환용)
 */
import Modal, { type ModalProps } from '../../common/Modal';

export default function PanelModal(props: ModalProps) {
    return <Modal {...props} />;
}
