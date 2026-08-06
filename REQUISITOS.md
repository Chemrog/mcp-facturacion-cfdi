# Requisitos para conectar el MCP de Facturación CFDI a Claude

## Documentos que el usuario debe proporcionar a conectus.mx

### 1. Datos Fiscales
- RFC con homoclave
- Razón Social / Nombre Fiscal (sin régimen societario)
- Régimen Fiscal (clave SAT de 3 dígitos)
- Código Postal del domicilio fiscal

### 2. CSD (Certificado de Sello Digital)
- Archivo `.cer` del CSD
- Archivo `.key` del CSD
- Contraseña de la llave privada

> ⚠️ El CSD **NO** es la e.firma/FIEL. El CSD se genera desde el portal del SAT usando la e.firma.
> El CSD es para timbrar facturas. La e.firma es para trámites fiscales.

### 3. e.firma / FIEL (para Carta Manifiesto)
- Archivo `.cer` de la e.firma
- Archivo `.key` de la e.firma  
- Contraseña de la llave privada

> ⚠️ La e.firma se usa **exclusivamente** para firmar la Carta Manifiesto (requisito SAT).
> No se almacena ni se usa para timbrar facturas.

### 4. Carta Manifiesto firmada
- Documento obligatorio del SAT donde el contribuyente autoriza al PAC (PRODIGIA)
  a timbrar CFDI en su nombre.
- Se firma con la e.firma.
- conectus.mx gestiona este proceso automáticamente.

---

## Flujo de la Carta Manifiesto

```
Contribuyente → (firma con e.firma) → PRODIGIA (PAC autorizado SAT)
                                           ↓
                                      FacturAPI (integrador API)
                                           ↓
                                      conectus.mx (plataforma)
                                           ↓
                                      MCP → Claude / IA
```

- **La Carta Manifiesto es entre el Contribuyente y PRODIGIA (PAC)**
- conectus.mx actúa como intermediario pero el manifiesto legal queda a nombre del contribuyente
- FacturAPI gestiona la integración con PRODIGIA
- El usuario final de conectus.mx **nunca ve** PRODIGIA ni FacturAPI

---

## Checklist previo a activar el MCP

- [ ] Cuenta creada en conectus.mx
- [ ] Datos fiscales completos (RFC, razón social, régimen, CP)
- [ ] CSD cargado y verificado (.cer + .key + contraseña)
- [ ] CSD vigente (verificar fecha de vencimiento, renovar 30 días antes)
- [ ] e.firma cargada
- [ ] Carta Manifiesto firmada con e.firma
- [ ] Plan/Suscripción activa en conectus.mx
- [ ] MCP conectado a Claude desde el marketplace de conectus.mx
