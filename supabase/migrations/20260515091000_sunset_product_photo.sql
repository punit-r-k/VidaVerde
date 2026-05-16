update products
set
  image_url = '/product-photos/Sunset.webp',
  updated_at = now()
where sku = 'VV2';
