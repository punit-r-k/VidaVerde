update products
set
  image_url = '/product-photos/Hell-Yeah.webp',
  updated_at = now()
where sku = 'VV6';
