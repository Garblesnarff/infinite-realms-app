export interface FolderNode {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  parentFolderId?: string | null;
  characterCount: number;
  children?: FolderNode[];
}

export interface FolderTreeProps {
  onFolderSelect?: (folderId: string | null) => void;
  selectedFolderId?: string | null;
  onCreateFolder?: () => void;
  onEditFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onChangeColor?: (folderId: string) => void;
  onCharacterDrop?: (characterId: string, folderId: string | null) => void;
}

export interface FolderItemProps {
  folder: FolderNode;
  level: number;
  isSelected: boolean;
  onSelect: (folderId: string | null) => void;
  onEdit: (folderId: string) => void;
  onDelete: (folderId: string) => void;
  onChangeColor: (folderId: string) => void;
  onCharacterDrop?: (characterId: string, folderId: string | null) => void;
}
