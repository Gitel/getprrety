import { useEffect, useState } from 'react';
import { fetchCatalogueProducts } from './catalogueApi';

// Stable string for a set of ids: same ids in any order give the same key, so the effect
// below does not re-run when a screen rebuilds an equal array on every render.
export const idsKey = ids => [...new Set(ids || [])].sort().join(',');

// useCatalogueProducts(ids) -> { products: { [id]: product }, loading }
export function useCatalogueProducts(ids) {
  const key = idsKey(ids);
  const [state, setState] = useState({ products: {}, loading: key !== '' });

  useEffect(() => {
    let active = true; // set to false on unmount / id change so late results are ignored
    if (key === '') {
      setState({ products: {}, loading: false });
      return undefined;
    }
    setState(prev => ({ ...prev, loading: true }));
    fetchCatalogueProducts(key.split(',')).then(products => {
      if (active) setState({ products, loading: false });
    });
    return () => { active = false; };
  }, [key]);

  return state;
}
