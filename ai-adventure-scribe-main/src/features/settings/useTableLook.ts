import { useEffect } from 'react';

/** Table materials are always on at launch. Every route that uses them gets the body class. */
export const useTableLook = (): void => {
  useEffect(() => {
    document.body.classList.add('ir-table-look');
    return () => {
      document.body.classList.remove('ir-table-look');
    };
  }, []);
};
