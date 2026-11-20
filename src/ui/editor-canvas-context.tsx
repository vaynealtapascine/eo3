import { createContext, useContext } from 'react';
import type { CssPiece } from '../editor/css-pieces';

export interface EditorCanvasContextValue {
    /** Live CSS reaching the active part, injected scoped into the WYSIWYG canvas. */
    canvasCss: string;
    /** Ensures a CSS Piece's AO3-safe rules are attached to the work's stylesheet. */
    ensurePieceCss?: (piece: CssPiece) => void | Promise<boolean>;
    /** True when rendered in Simple view (for streamlined WYSIWYG chrome). */
    isSimpleView: boolean;
}

export const EditorCanvasContext = createContext<EditorCanvasContextValue>({
    canvasCss: '',
    isSimpleView: false,
});

export function useEditorCanvas(): EditorCanvasContextValue {
    return useContext(EditorCanvasContext);
}
