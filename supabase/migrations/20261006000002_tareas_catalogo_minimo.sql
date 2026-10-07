-- Catálogo mínimo de tareas: los nombres viejos o libres pasan al nombre general que los absorbe.
-- Nada se pierde: el nombre anterior se conserva como inicio de la nota corta de la tarea (action_path.note).
-- Solo toca tareas de producción que siguen abiertas. Las terminadas conservan su historia tal cual;
-- la app las muestra con el nombre nuevo (alias en el código).
with map as (
  select id, descripcion as old, action_path,
    case
      when lower(descripcion) in ('comprar material','ordenar a monterrey','ordenar en linea','recibir material') then 'ORDENAR MATERIAL'
      when lower(descripcion) like 'comprar%' or lower(descripcion) like 'pedido%' then 'ORDENAR MATERIAL'
      when lower(descripcion) in ('cortar','estampar dtf','dar acabados','instalar','mejorar calidad') then 'FABRICAR'
      when lower(descripcion) in ('imprimir lona','enviar dtf','enviar dtf uv','enviar tabloides') then 'ENVIAR TRABAJO CON PROVEEDOR'
      when lower(descripcion) = 'confirmar diseno' then 'CONSEGUIR APROBACION'
      when lower(descripcion) in ('comunicarse por whatsapp','enviar cotizacion','pedir anticipo') or lower(descripcion) like 'mandarle%' then 'CONTACTAR CLIENTE'
      when lower(descripcion) in ('diseño','revisar archivo') then 'REALIZAR DISENO'
      when lower(descripcion) in ('crear ticket de envio','llevar a taller') then 'ENTREGAR'
      when lower(descripcion) in ('pirate ship','cobrar') then 'TAREA ADMINISTRATIVA'
    end as nuevo
  from tareas
  where tipo = 'produccion' and estado <> 'terminado'
), base as (
  select id, old, nuevo,
    case when coalesce(action_path,'') = '' then '{}'::jsonb else action_path::jsonb end as meta
  from map where nuevo is not null
)
update tareas t
set descripcion = b.nuevo,
    area = case when b.nuevo = 'FABRICAR' then 'produccion' else 'planeacion' end,
    action_path = (b.meta || jsonb_build_object('note', concat_ws(' · ',
      case when lower(b.old) in ('comprar material','ordenar a monterrey','ordenar en linea','confirmar diseno','diseño') then null else b.old end,
      nullif(b.meta->>'note','')
    )))::text
from base b
where t.id = b.id;

-- FABRICAR siempre es del taller.
update tareas set area = 'produccion' where tipo = 'produccion' and descripcion = 'FABRICAR' and estado <> 'terminado' and area is distinct from 'produccion';
