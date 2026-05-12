update products
set
  image_url = '/product-photos/Red-Coral.webp',
  updated_at = now()
where sku = 'VV1';
