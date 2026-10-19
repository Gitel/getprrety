import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { photoUrl } from '../lib/catalogueApi';
import { openCheckout } from '../lib/openCheckout';

// One SR Cosmetics catalogue product, used by the My products screen.
//   id          catalogue id (24 hex) or a fallback key such as "am-2"; becomes the card testID suffix
//   product     catalogue data from useCatalogueProducts (undefined when the fetch failed or the id is
//               unknown: the card then shows text only, using fallbackName)
//   fallbackName  the product name saved inside the analysis (always available)
//   color       accent colour (the era colour)
//   heroCopy    true for the hero card at the top of My products: the same product also appears in the
//               ritual, and the photo testID must stay unique on the page, so the hero photo has none
//   children    extra content shown under the name (use instruction, reason, active pills...)
export default function CatalogueProductCard({ id, product, fallbackName, color, heroCopy, children }) {
  const { t, i18n } = useTranslation();
  const photo = photoUrl(product); // null when there is no catalogue data or no photo
  const name = product?.name || fallbackName;
  // Price as money in the app language, e.g. "₪24.00". Shown only when the admin set a price.
  const price = typeof product?.price === 'number'
    ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'ILS' }).format(product.price)
    : null;
  // Archived products stay visible (they are in the saved analysis) but cannot be bought.
  const canBuy = Boolean(product?.shopUrl) && !product.archived;

  return (
    <View testID={`product-card-${id}`} style={[s.card, { borderColor: color + '30' }]}>
      <View style={s.row}>
        {photo ? (
          <Image testID={heroCopy ? undefined : `product-photo-${id}`} source={{ uri: photo }} style={s.photo} resizeMode="cover" />
        ) : null}
        <View style={s.info}>
          <Text style={[s.name, { color }]}>{name}</Text>
          {price ? <Text testID={`product-price-${id}`} style={s.price}>{price}</Text> : null}
          {product?.archived ? <Text style={s.unavailable}>{t('products:card.unavailable')}</Text> : null}
        </View>
      </View>
      {children}
      {canBuy ? (
        <Pressable
          testID={`product-buy-${id}`}
          onPress={() => openCheckout(product.shopUrl)}
          style={[s.buy, { backgroundColor: color }]}
          accessibilityRole="button"
        >
          <Text style={s.buyText}>{t('products:card.buy')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Logical props only (marginStart etc.) so the card mirrors in Hebrew.
const s = StyleSheet.create({
  card:        { backgroundColor: C.card, borderRadius: 13, padding: 13, borderWidth: 1 },
  row:         { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  photo:       { width: 64, height: 64, borderRadius: 10, backgroundColor: C.border, marginEnd: 12 },
  info:        { flex: 1 },
  name:        { fontFamily: 'DMSans_500Medium', fontSize: 14 },
  price:       { fontFamily: 'DMSans_500Medium', fontSize: 12, color: C.text, marginTop: 3 },
  unavailable: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#C44B4B', marginTop: 3 },
  buy:         { alignSelf: 'flex-start', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14, marginTop: 8 },
  buyText:     { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#FFF' },
});
