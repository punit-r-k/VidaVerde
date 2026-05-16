update products
set
  image_url = '/product-photos/Caribbean-Heat.webp',
  updated_at = now()
where sku = 'VV3';
