update products
set
  image_url = '/product-photos/Endless-Summer.webp',
  updated_at = now()
where sku = 'VV4';
