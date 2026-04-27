-- Precarga local derivada desde data_piloto_paz_y_salvos.xlsx
-- Generado por scripts/generate_piloto_seed.py
-- Credenciales semilla:
--   - Estudiantes/docentes: documento + clave temporal PazYSalvo2026!
--   - Coordinadores: usuario derivado del correo (antes del @) + clave temporal PazYSalvo2026!

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE tmp_seed_coordinadores (
    nombre TEXT NOT NULL,
    documento VARCHAR(50) NOT NULL,
    correo VARCHAR(255) NOT NULL,
    nombre_u VARCHAR(50) NOT NULL,
    facultad_nombre TEXT NOT NULL,
    estado_origen TEXT NOT NULL,
    auth_tipo TEXT NOT NULL,
    numero_resolucion_coordinador VARCHAR(100) NOT NULL,
    soporte_resolucion TEXT NOT NULL
);

INSERT INTO tmp_seed_coordinadores (
    nombre,
    documento,
    correo,
    nombre_u,
    facultad_nombre,
    estado_origen,
    auth_tipo,
    numero_resolucion_coordinador,
    soporte_resolucion
)
VALUES
    ('CLAUDIA MABEL MORENO PENAGOS', '51953330', 'labindustrialft@udistrital.edu.co', 'labindustrialft', 'Tecnologica', 'Activo', 'coordinador', 'RES-PILOTO-51953330', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
    ('DIEGO ARMANDO GIRAL RAMIREZ', '1022339649', 'lab-tecelectrica@udistrital.edu.co', 'lab-tecelectrica', 'Tecnologica', 'Activo', 'coordinador', 'RES-PILOTO-1022339649', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
    ('HENRY MONTANA QUINTERO', '79715783', 'audiovisualestecno@udistrital.edu.co', 'audiovisualestecno', 'Tecnologica', 'Activo', 'coordinador', 'RES-PILOTO-79715783', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
    ('HENRY MORENO ACOSTA', '19475241', 'labtecmecanica@udistrital.edu.co', 'labtecmecanica', 'Tecnologica', 'Activo', 'coordinador', 'RES-PILOTO-19475241', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
    ('JOSE DAVID CELY CALLEJAS', '79055619', 'labtronica@udistrital.edu.co', 'labtronica', 'Tecnologica', 'Activo', 'coordinador', 'RES-PILOTO-79055619', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
    ('MILLER GOMEZ MORA', '79520182', 'labsistemastecno@udistrital.edu.co', 'labsistemastecno', 'Tecnologica', 'Activo', 'coordinador', 'RES-PILOTO-79520182', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
    ('RODOLFO FELIZZOLA RAMIREZ', '79321899', 'labciviles@udistrital.edu.co', 'labciviles', 'Tecnologica', 'Activo', 'coordinador', 'RES-PILOTO-79321899', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
    ('Wilmar Dario Fernandez Gomez', '79494815', 'labmedioambiente@udistrital.edu.co', 'labmedioambiente', 'Vivero', 'Activo', 'coordinador', 'RES-PILOTO-79494815', 'Precarga local derivada desde data_piloto_paz_y_salvos.xlsx');

CREATE TEMP TABLE tmp_seed_usuarios (
    nombre TEXT NOT NULL,
    documento VARCHAR(50) NOT NULL,
    codigo BIGINT,
    carrera TEXT,
    estado VARCHAR(50) NOT NULL,
    correo VARCHAR(255) NOT NULL,
    tipo VARCHAR(20) NOT NULL
);

INSERT INTO tmp_seed_usuarios (
    nombre,
    documento,
    codigo,
    carrera,
    estado,
    correo,
    tipo
)
VALUES
    ('VELASCO VELANDIA CEDRIC DAMIAN', '1011092961', 20231379166, 'TECNOLOGIA EN CONSTRUCCIONES CIVILES (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'cdvelascov@udistrital.edu.co', 'estudiante'),
    ('VALDERRAMA MARTINEZ LINA SOFIA', '1013115419', 20252673038, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'lsvalderramam@udistrital.edu.co', 'estudiante'),
    ('TIBOCHE GARCÍA SANTIAGO', '1018475627', 20191181031, 'INGENIERIA SANITARIA', 'ACTIVO', 'stibocheg@udistrital.edu.co', 'estudiante'),
    ('TELLEZ PINZON JERFRY YESID', '1011095654', 20242180048, 'INGENIERIA AMBIENTAL', 'PRUEBA AC Y ACTIVO', 'jytellezp@udistrital.edu.co', 'estudiante'),
    ('SUAREZ VALLES JAIRO ANDRES', '1001078293', 20222180056, 'INGENIERIA AMBIENTAL', 'ACTIVO', 'jasuarezv@udistrital.edu.co', 'estudiante'),
    ('SOTOMAYOR DELGADO MARIA ALEJANDRA', '1000269214', 20181181022, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'masotomayord@udistrital.edu.co', 'estudiante'),
    ('SOLANO INDABUR LAURA TATIANA', '1000785549', 20201181003, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'ltsolanoi@udistrital.edu.co', 'estudiante'),
    ('SIERRA MORALES ANDERSON DAVID', '1010245932', 20211673015, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'adsierram@udistrital.edu.co', 'estudiante'),
    ('SIERRA ACOSTA MARIA PAULA', '1029140663', 20242673039, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'mpsierraa@udistrital.edu.co', 'estudiante'),
    ('SANTAMARIA PATIÑO DANIELA', '1022342978', 20242081005, 'TECNOLOGÍA EN GESTIÓN AMBIENTAL Y SERVICIOS PÚBLICOS', 'VACACIONES', 'dsantamariap@udistrital.edu.co', 'estudiante'),
    ('SANCHEZ BUITRAGO JHONATAN STEVE', '1002634470', 20231185043, 'ADMINISTRACION AMBIENTAL', 'VACACIONES', 'jhssanchezb@udistrital.edu.co', 'estudiante'),
    ('SANCHEZ BOHORQUEZ JUAN FELIPE', '1034399919', 20242673096, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'jfsanchezb@udistrital.edu.co', 'estudiante'),
    ('SALGUERO MORALES LUIS ALEJANDRO', '1032676192', 20211673021, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'lasalguerom@udistrital.edu.co', 'estudiante'),
    ('ROMERO VELEZ JUAN PABLO', '1021314387', 20251001026, 'ADMINISTRACION DEPORTIVA', 'PRUEBA ACAD', 'jpromerov@udistrital.edu.co', 'estudiante'),
    ('ROMERO URQUIJO DAMIAN STEVE', '1024596056', 20202001091, 'ADMINISTRACION DEPORTIVA', 'PRUEBA AC Y ACTIVO', 'dsromerou@udistrital.edu.co', 'estudiante'),
    ('ROJAS VARGAS DAVID LEONARDO', '1013671652', 20251010044, 'INGENIERIA FORESTAL', 'PRUEBA ACAD', 'dlrojasv@udistrital.edu.co', 'estudiante'),
    ('ROJAS RODRIGUEZ DANIEL FELIPE', '1019024259', 20242574015, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'PRUEBA AC Y ACTIVO', 'danifrojasr@udistrital.edu.co', 'estudiante'),
    ('RODRIGUEZ VELASQUEZ SAMUEL NICOLAS', '1020821343', 20162181256, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'snrodriguezv@udistrital.edu.co', 'estudiante'),
    ('RODRIGUEZ ROBAYO MARLON FERNANDO JUNIOR', '1005702056', 20242377064, 'INGENIERIA DE PRODUCCION (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'mfrodriguezr@udistrital.edu.co', 'estudiante'),
    ('RODRIGUEZ ROBAYO ASHLIN DAHIANA', '1000158817', 20252010018, 'INGENIERIA FORESTAL', 'ACTIVO', 'asdrodriguezr@udistrital.edu.co', 'estudiante'),
    ('RODRIGUEZ BENAVIDES ANDRES DAVID', '1012351692', 20252010029, 'INGENIERIA FORESTAL', 'ACTIVO', 'adrodriguezb@udistrital.edu.co', 'estudiante'),
    ('RENDON DAZA ANDERSON DAVID', '1033696090', 20241673054, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'CANCELADO', 'adrendond@udistrital.edu.co', 'estudiante'),
    ('QUIROGA MOLANO DAVID ESTEVAN', '1012317427', 20222574044, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'ACTIVO', 'dequirogam@udistrital.edu.co', 'estudiante'),
    ('PRIETO PARDO CRISTIAN ADRIAN', '1072718632', 20242379122, 'TECNOLOGIA EN CONSTRUCCIONES CIVILES (CICLOS PROPEDEUTICOS)', 'NO ESTUDIANTE AC004', 'craprietop@udistrital.edu.co', 'estudiante'),
    ('PRIETO MANRIQUE STEFANNY JULIETH', '1000784022', 20232377064, 'INGENIERIA DE PRODUCCION (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'sjprietom@udistrital.edu.co', 'estudiante'),
    ('PIÑEROS JIMENEZ JUAN DAVID', '1013120401', 20252574027, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'VACACIONES', 'jdpinerosj@udistrital.edu.co', 'estudiante'),
    ('PINZON GOMEZ KAREN JULIETH', '1020832629', 20192010041, 'INGENIERIA FORESTAL', 'ACTIVO', 'kjpinzong@udistrital.edu.co', 'estudiante'),
    ('PINEDA GONZALEZ GREYSS STEPHANIE', '1011324190', 20251032067, 'INGENIERIA TOPOGRAFICA', 'ACTIVO', 'gspinedag@udistrital.edu.co', 'estudiante'),
    ('PEÑA MARROQUIN FRANKLIN ESTIBEN', '1033765885', 20252732002, 'INGENIERIA TOPOGRAFICA (PROF. TECNOLOGOS)', 'ACTIVO', 'fepenam@udistrital.edu.co', 'estudiante'),
    ('PEREZ PEREZ ANDRES STIVEN', '1012337787', 20231574063, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'PRUEBA AC Y ACTIVO', 'asperezp@udistrital.edu.co', 'estudiante'),
    ('PERALTA RODRÍGUEZ DAVID SANTIAGO', '1034779711', 20241578091, 'TECNOLOGIA EN SISTEMATIZACION DE DATOS (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'dsperaltar@udistrital.edu.co', 'estudiante'),
    ('PEDRAZA CHAMORRO NATHALIA IBETH', '1000493161', 20191181033, 'INGENIERIA SANITARIA', 'ACTIVO', 'nipedrazac@udistrital.edu.co', 'estudiante'),
    ('PAYANENE MONTENEGRO BRAYAN SNEIDER', '1012321294', 20221001055, 'ADMINISTRACION DEPORTIVA', 'PRUEBA AC Y ACTIVO', 'bspayanenem@udistrital.edu.co', 'estudiante'),
    ('PAVA RODRIGUEZ JAVIER ALEJANDRO', '1033782960', 20232373005, 'INGENIERIA EN TELECOMUNICACIONES (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'japavar@udistrital.edu.co', 'estudiante'),
    ('PARRAGA IBAÑEZ YEIDER ROLANDO', '1022387354', 20232375004, 'INGENIERIA MECANICA (CICLOS PROPEDEUTICOS)', 'VACACIONES', 'yrparragai@udistrital.edu.co', 'estudiante'),
    ('PAMPLONA GUTIERREZ VALERIA', '1000973174', 20241377024, 'INGENIERIA DE PRODUCCION (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'vpamplonag@udistrital.edu.co', 'estudiante'),
    ('ORTEGA BOADA SANTIAGO ANDRES', '1032940389', 20251574142, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'PRUEBA ACAD', 'saortegab@udistrital.edu.co', 'estudiante'),
    ('ORDUZ GARCIA JUAN ANDRES', '1031808806', 20242180058, 'INGENIERIA AMBIENTAL', 'PRUEBA AC Y ACTIVO', 'jaorduzg@udistrital.edu.co', 'estudiante'),
    ('MUÑOZ MARTINEZ DAVID RICARDO', '1010008884', 20182131034, 'TECNOLOGIA EN LEVANTAMIENTOS TOPOGRAFICOS', 'NO ESTUDIANTE AC004', 'drmunozm@udistrital.edu.co', 'estudiante'),
    ('MORENO PARRA YIVER STIVEN', '1002522233', 20241678029, 'INGENIERIA EN TELEMATICA (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'ysmorenop@udistrital.edu.co', 'estudiante'),
    ('MORENO LEMUS JOSEPH SANTIAGO', '1013111452', 20242673009, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'jsmorenol@udistrital.edu.co', 'estudiante'),
    ('MORALES RIOS CARLOS ALBERTO', '18263569', 20211579015, 'INGENIERIA CIVIL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'camoralesr@udistrital.edu.co', 'estudiante'),
    ('MONTES CONTRERAS LAURA VALENTINA', '1000124096', 20191181038, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'lvmontesc@udistrital.edu.co', 'estudiante'),
    ('MONTERO PRIETO MARIANA', '1013148397', 20252185075, 'ADMINISTRACION AMBIENTAL', 'ACTIVO', 'mmonterop@udistrital.edu.co', 'estudiante'),
    ('MENDEZ PIRATOVA BRANDON YESSID', '1024493822', 20251574086, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'PRUEBA AC Y ACTIVO', 'bymendezp@udistrital.edu.co', 'estudiante'),
    ('MELO MARTIN DIANA CAROLINA', '1013109128', 20231180014, 'INGENIERIA AMBIENTAL', 'ACTIVO', 'dcmelom@udistrital.edu.co', 'estudiante'),
    ('MELO GOMEZ MARCOS FELIPE', '1078346332', 20232574090, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'PRUEBA AC Y ACTIVO', 'mfmelog@udistrital.edu.co', 'estudiante'),
    ('MEJIA GALINDO JULIAN CAMILO', '1003641999', 20211577019, 'TECNOLOGIA EN GESTION DE LA PRODUCCION INDUSTRIAL', 'ACTIVO', 'jcmejiag@udistrital.edu.co', 'estudiante'),
    ('MARTINEZ LINARES RACHEL SOFIA', '1014311870', 20251181033, 'INGENIERIA SANITARIA', 'ACTIVO', 'rsmartinezl@udistrital.edu.co', 'estudiante'),
    ('MARIN ARCILA JUAN CARLOS', '1014182298', 20242001111, 'ADMINISTRACION DEPORTIVA', 'PRUEBA AC Y ACTIVO', 'jucmarina@udistrital.edu.co', 'estudiante'),
    ('MAHECHA MORENO SHARON TATIANA', '1000593459', 20201032096, 'INGENIERIA TOPOGRAFICA', 'NO ESTUDIANTE AC004', 'ajmorenom@udistrital.edu.co', 'estudiante'),
    ('LEURO SERRANO DYLAN STEVE', '1010963445', 20251180054, 'INGENIERIA AMBIENTAL', 'PRUEBA AC Y ACTIVO', 'dsleuros@udistrital.edu.co', 'estudiante'),
    ('LAVACUDE NOVOA JORGE ESTEBAN', '1012918413', 20251673052, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA ACAD', 'jelavacuden@udistrital.edu.co', 'estudiante'),
    ('LARROTA ROJAS LEANDRO LEONARDO', '79850414', 20052279039, 'INGENIERIA CIVIL (CICLOS PROPEDEUTICOS)', 'PRUEBA ACAD', 'lllarrotar@udistrital.edu.co', 'estudiante'),
    ('LAGUNA RAMIREZ KEVIN DAVID', '1013110102', 20242673041, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'kdlagunar@udistrital.edu.co', 'estudiante'),
    ('JIMENEZ DURAN NATAN MATEO', '1019903156', 20241001055, 'ADMINISTRACION DEPORTIVA', 'NO ESTUDIANTE AC004', 'nmjimenezd@udistrital.edu.co', 'estudiante'),
    ('IZA HERNANDEZ ANDRES FELIPE', '1021673216', 20241180040, 'INGENIERIA AMBIENTAL', 'PRUEBA AC Y ACTIVO', 'afizah@udistrital.edu.co', 'estudiante'),
    ('HUERTAS MORENO IVAN ESNEIDER', '1030559364', 20251673110, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'iehuertasm@udistrital.edu.co', 'estudiante'),
    ('HIGUERA SAENZ LUISA FERNANDA', '1034576704', 20231673095, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'lfhigueras@udistrital.edu.co', 'estudiante'),
    ('HERRERA CASTELLANOS NICOLAS STEVAN', '1023968369', 20192081015, 'TECNOLOGÍA EN GESTIÓN AMBIENTAL Y SERVICIOS PÚBLICOS', 'ACTIVO', 'nisherrerac@udistrital.edu.co', 'estudiante'),
    ('HERNANDEZ OTALORA ASTRID CAROLINA', '1118362910', 20222181040, 'INGENIERIA SANITARIA', 'ACTIVO', 'achernandezo@udistrital.edu.co', 'estudiante'),
    ('HEREDIA CUBILLOS MELKISEDECK', '1028863152', 20251181048, 'INGENIERIA SANITARIA', 'ACTIVO', 'mherediac@udistrital.edu.co', 'estudiante'),
    ('GUTIERREZ BERNAL DEYVID SEBASTIAN', '1033809883', 20232578101, 'TECNOLOGIA EN SISTEMATIZACION DE DATOS (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'dsgutierrezb@udistrital.edu.co', 'estudiante'),
    ('GUERRERO RESTREPO ESTEBAN DAVID', '1028484485', 20241181072, 'INGENIERIA SANITARIA', 'ACTIVO', 'edguerreror@udistrital.edu.co', 'estudiante'),
    ('GIRALDO PANTEVEZ JEIDY TATIANA', '1006825073', 20202181001, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'jetgiraldop@udistrital.edu.co', 'estudiante'),
    ('GARZON GUERRA DAVID ALEJANDRO', '1011090782', 20251673128, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'daagarzong@udistrital.edu.co', 'estudiante'),
    ('GAITAN MORENO NATALIA', '1032488554', 20191710003, 'INGENIERIA FORESTAL (PROF. TECNOLOGOS)', 'TERMINO Y MATRICULO', 'ngaitanm@udistrital.edu.co', 'estudiante'),
    ('GAITAN CALVO DIEGO ALEJANDRO', '1000601755', 20251574010, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'ACTIVO', 'dagaitanc@udistrital.edu.co', 'estudiante'),
    ('FRANCO TORRES KAROL GISELL', '1192749077', 20252131016, 'TECNOLOGIA EN LEVANTAMIENTOS TOPOGRAFICOS', 'ACTIVO', 'kgfrancot@udistrital.edu.co', 'estudiante'),
    ('ESPITIA COLLAZOS MONICA ALEXANDRA', '1016834955', 20252010052, 'INGENIERIA FORESTAL', 'ACTIVO', 'moaespitiac@udistrital.edu.co', 'estudiante'),
    ('ELIZALDE JIMENEZ GINA PAOLA', '1022380939', 20192781006, 'INGENIERIA SANITARIA (PROF. TECNOLOGOS)', 'TERMINO Y MATRICULO', 'gpelizaldej@udistrital.edu.co', 'estudiante'),
    ('DIAZ VARGAS MICHELL', '1019842173', 20251001001, 'ADMINISTRACION DEPORTIVA', 'ACTIVO', 'mdiazv@udistrital.edu.co', 'estudiante'),
    ('DIAZ GALINDO THOMAS FELIPE', '1030544353', 20241181082, 'INGENIERIA SANITARIA', 'ACTIVO', 'tfdiazg@udistrital.edu.co', 'estudiante'),
    ('DIAZ ALDANA OSCAR JULIAN', '1021669151', 20242081001, 'TECNOLOGÍA EN GESTIÓN AMBIENTAL Y SERVICIOS PÚBLICOS', 'ABANDONO', 'ojdiaza@udistrital.edu.co', 'estudiante'),
    ('DAZA PRIETO JHONATAN ANDRES', '1000707041', 20192181044, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'jadazap@udistrital.edu.co', 'estudiante'),
    ('CUERVO ALVARADO ELBER SANTIAGO', '1000989654', 20212574106, 'TECNOLOGIA EN MECANICA INDUSTRIAL', 'NO ESTUDIANTE AC004', 'escuervoa@udistrital.edu.co', 'estudiante'),
    ('CRUZ DURAN GERALDINE', '1001176513', 20212081036, 'TECNOLOGÍA EN GESTIÓN AMBIENTAL Y SERVICIOS PÚBLICOS', 'ACTIVO', 'gcruzd@udistrital.edu.co', 'estudiante'),
    ('CORREA MACIAS FABIAN JOSE', '1012391190', 20241375002, 'INGENIERIA MECANICA (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'fjcorream@udistrital.edu.co', 'estudiante'),
    ('CHACON GONZALEZ DIEGO ALEJANDRO', '1072618161', 20252673009, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'diachacong@udistrital.edu.co', 'estudiante'),
    ('CELY BAYONA MABEL DANIELA', '1005300088', 20252180069, 'INGENIERIA AMBIENTAL', 'PRUEBA ACAD', 'mdcelyb@udistrital.edu.co', 'estudiante'),
    ('CAÑON NIEVES LAURA VALENTINA', '1007107294', 20252001086, 'ADMINISTRACION DEPORTIVA', 'PRUEBA ACAD', 'lvcanonn@udistrital.edu.co', 'estudiante'),
    ('CASTILLO CUERVO MIGUEL ANGEL', '1022376483', 20202673042, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'miacastilloc@udistrital.edu.co', 'estudiante'),
    ('CASTELBLANCO MARTINEZ MICHELL ANDRES', '1023022267', 20182181023, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'macastelblancom@udistrital.edu.co', 'estudiante'),
    ('CASAGUA GUTIERREZ JUAN DAVID', '1000694178', 20211081025, 'TECNOLOGÖA EN GESTIàN AMBIENTAL Y SERVICIOS PéBLICOS', 'NO ESTUDIANTE AC004', 'dfvargasa@udistrital.edu.co', 'estudiante'),
    ('CARRERO VILLAMIL DAVID MATEO', '1012918360', 20252131007, 'TECNOLOGIA EN LEVANTAMIENTOS TOPOGRAFICOS', 'ACTIVO', 'dmcarrerov@udistrital.edu.co', 'estudiante'),
    ('CARANTON MARIN MIGUEL ANGEL', '1011085843', 20231379118, 'TECNOLOGIA EN CONSTRUCCIONES CIVILES (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'macarantonm@udistrital.edu.co', 'estudiante'),
    ('BUITRAGO FLOREZ PAULA ALEJANDRA', '1000471415', 20181010057, 'INGENIERIA FORESTAL', 'TERMINO Y MATRICULO', 'pabuitragof@udistrital.edu.co', 'estudiante'),
    ('BOADA POVEDA MICHAEL ENRIQUE', '1014478788', 20232379108, 'TECNOLOGIA EN CONSTRUCCIONES CIVILES (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'meboadap@udistrital.edu.co', 'estudiante'),
    ('BERNAL ZARATE GABRIELA', '1034517490', 20241379132, 'TECNOLOGIA EN CONSTRUCCIONES CIVILES (CICLOS PROPEDEUTICOS)', 'PRUEBA AC Y ACTIVO', 'gbernalz@udistrital.edu.co', 'estudiante'),
    ('BARBOSA TORRES JOHAN ESTEBAN', '1073681577', 20241577161, 'TECNOLOGIA EN GESTION DE LA PRODUCCION INDUSTRIAL', 'PRUEBA AC Y ACTIVO', 'jebarbosat@udistrital.edu.co', 'estudiante'),
    ('BARBOSA CARDENAS JHON STIVEN', '1023375159', 20252673053, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'jsbarbosac@udistrital.edu.co', 'estudiante'),
    ('AVILA OJEDA ANDRES FELIPE', '1014209126', 20252181040, 'INGENIERIA SANITARIA', 'ACTIVO', 'afavilao@udistrital.edu.co', 'estudiante'),
    ('ARIAS RODRIGUEZ LAURA MAYERLY', '1012316418', 20201181005, 'INGENIERIA SANITARIA', 'TERMINO Y MATRICULO', 'lmariasr@udistrital.edu.co', 'estudiante'),
    ('ARANGO VIRGUEZ MIGUEL ANGEL', '1027525032', 20251001087, 'ADMINISTRACION DEPORTIVA', 'PRUEBA AC Y ACTIVO', 'maarangov@udistrital.edu.co', 'estudiante'),
    ('ARANGO CRUZ MARINA ESTEFANIA', '1003567469', 20222180058, 'INGENIERIA AMBIENTAL', 'PRUEBA AC Y ACTIVO', 'mearangoc@udistrital.edu.co', 'estudiante'),
    ('ALVIS HORTUA MICHAEL STEVEN', '1000687707', 20242010015, 'INGENIERIA FORESTAL', 'PRUEBA AC Y ACTIVO', 'msalvish@udistrital.edu.co', 'estudiante'),
    ('ALVAREZ VALDERRAMA TANYA VALENTINA', '1012323072', 20252185056, 'ADMINISTRACION AMBIENTAL', 'PRUEBA ACAD', 'tvalvarezv@udistrital.edu.co', 'estudiante'),
    ('ALARCON MURCIA JAVIER STEVEN', '1000783730', 20242781006, 'INGENIERIA SANITARIA (PROF. TECNOLOGOS)', 'ACTIVO', 'jsalarconm@udistrital.edu.co', 'estudiante'),
    ('AGUIRRE VILLAMIL BRAYAN ESTEBAN', '1033676420', 20222379144, 'TECNOLOGIA EN CONSTRUCCIONES CIVILES (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'beaguirrev@udistrital.edu.co', 'estudiante'),
    ('ACUNA MOLINA JUAN SEBASTIAN', '1013036291', 20212673101, 'TECNOLOGÍA EN ELECTRÓNICA INDUSTRIAL (CICLOS PROPEDEUTICOS)', 'ACTIVO', 'jsacunam@udistrital.edu.co', 'estudiante');

CREATE TEMP TABLE tmp_seed_multas (
    id INTEGER NOT NULL,
    cat_multa TEXT NOT NULL,
    nombre_laboratorista VARCHAR(500) NOT NULL,
    cod_multado NUMERIC(20,0) NOT NULL,
    ual TEXT NOT NULL,
    fecha_multa DATE NOT NULL,
    con_estado_multa TEXT NOT NULL,
    obs_multa TEXT NOT NULL
);

INSERT INTO tmp_seed_multas (
    id,
    cat_multa,
    nombre_laboratorista,
    cod_multado,
    ual,
    fecha_multa,
    con_estado_multa,
    obs_multa
)
VALUES
    (1, 'Ingreso de ni¤os y mascotas en las unidades acad‚micas de laboratorios', 'julian', 20211081025, 'Centro de Geoprocesamiento/Aula Especializada', '2025-09-18', 'SALDADA', 'Prueba multa prod'),
    (2, 'Ingreso de ni¤os y mascotas en las unidades acad‚micas de laboratorios', 'julian', 20211081025, 'Laboratorio Observatorio Astron¢mico', '2025-09-18', 'SALDADA', 'Prueba multa 2 prod'),
    (3, 'Ingreso de ni¤os y mascotas en las unidades acad‚micas de laboratorios', 'julian', 20211081025, 'Centro de Geoprocesamiento/Aula Especializada', '2025-09-18', 'ACTIVA', 'Prueba multa produccion'),
    (4, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Vanessa Alejandra Medellin Rodriguez', 20222574015, 'Laboratorio de mecánica de fluidos y máquinas hidráulicas', '2024-03-04', 'SALDADA', 'Mala manipulación de los equipos de mecánica de fluidos y fractura del hidrómetro'),
    (5, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Vanessa Alejandra Medellin Rodriguez', 20202574097, 'Laboratorio de mecánica de fluidos y máquinas hidráulicas', '2024-03-04', 'SALDADA', 'Mala manipulación de los equipos de mecánica de fluidos y fractura del hidrómetro'),
    (6, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Vanessa Alejandra Medellin Rodriguez', 20222574048, 'Laboratorio de mecánica de fluidos y máquinas hidráulicas', '2024-03-04', 'SALDADA', 'Mala manipulación de los equipos de mecánica de fluidos y fractura del hidrómetro'),
    (7, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Vanessa Alejandra Medellin Rodriguez', 20222574016, 'Laboratorio de mecánica de fluidos y máquinas hidráulicas', '2024-03-04', 'SALDADA', 'Mala manipulación de los equipos de mecánica de fluidos y fractura del hidrómetro'),
    (8, 'Consumir alimentos o bebidas dentro de las unidades académicas los laboratorios', 'YIVER STEVEN MORENO PARRA', 20251678049, 'Sala de informática 1', '2025-11-20', 'ACTIVA', 'Consumió alimentos dentro de la sala'),
    (9, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'JAVIER GIOVANNI PASTRANA GUTIERRREZ', 20241678029, 'Laboratorio redes y telemática', '2025-11-20', 'Pendiente', 'Daño la pantalla del equipo 8 de la sala'),
    (10, 'Fumar dentro de las unidades académicas de los laboratorios', 'Luis Guillermo Larrota Pulido', 20251678049, 'Laboratorio de simulación y realidad virtual (laboratorio de sistemas autónomos)', '2025-11-16', 'Pendiente', 'debe solicitar acompañamiento de bienestar y psicologia'),
    (11, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'JUAN FELIPE MOYANO FONSECA', 20242180099, 'Laboratorio De Microbiolog¡a Y Bioprospecci¢n Medioambiental', '2025-11-26', 'POR SALDAR', 'Tubo de ensayo 16x100mm roto por la estudiante'),
    (12, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'JUAN FELIPE MOYANO FONSECA', 20241180051, 'Laboratorio De Microbiolog¡a Y Bioprospecci¢n Medioambiental', '2025-11-26', 'POR SALDAR', 'Caja de Petri 90x15mm rota por la estudiante'),
    (13, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'NATALIA ANDREA DIAZ BERNAL', 20211010068, 'Xiloteca', '2025-04-22', 'Pendiente', 'Rotura de la laminilla microscópica de la especie Chanul (Humiriastrum procerum), perteneciente a la Xiloteca UDBC, durante su uso en laboratorio.'),
    (14, 'Abandono de los equipos prestados o no devolución en los plazos establecidos', 'MARIAM ELIZABETH VERA MORALES', 20221673088, 'Laboratorio de Diseño de producto', '2025-04-08', 'ACTIVA', 'No ha hecho entrega del filamento de las impresoras 3D que deben traer como contraprestación de la impresiones hechas por parte del laboratorio-Filamento PLA para impresoras 3D'),
    (15, 'Abandono de los equipos prestados o no devolución en los plazos establecidos', 'MARIAM ELIZABETH VERA MORALES', 20221973011, 'Laboratorio de Diseño de producto', '2025-04-08', 'ACTIVA', 'No ha hecho entrega del filamento de las impresoras 3D que deben traer como contraprestación de la impresiones hechas por parte del laboratorio-Filamento PLA para impresoras 3D'),
    (16, 'Abandono de los equipos prestados o no devolución en los plazos establecidos', 'MARIAM ELIZABETH VERA MORALES', 20221673008, 'Laboratorio de Diseño de producto', '2025-04-08', 'ACTIVA', 'No ha hecho entrega del filamento de las impresoras 3D que deben traer como contraprestación de la impresiones hechas por parte del laboratorio-Filamento PLA para impresoras 3D'),
    (17, 'Hacer uso de los equipos y herramientas sin autorización y/o sin conocer su adecuado manejo', 'Francy Liliana Lopez Rojas', 20222574092, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-10-15', 'Pendiente', 'Daño de reóstato de arranque ITALTEC por conexión errónea, pendiente reparación y realizar pruebas funcionales'),
    (18, 'Hacer uso de los equipos y herramientas sin autorización y/o sin conocer su adecuado manejo', 'Francy Liliana Lopez Rojas', 20222574028, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-10-15', 'Pendiente', 'Daño de reóstato de arranque ITALTEC por conexión errónea, pendiente reparación y realizar pruebas funcionales'),
    (19, 'Hacer uso de los equipos y herramientas sin autorización y/o sin conocer su adecuado manejo', 'Francy Liliana Lopez Rojas', 20211574117, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-10-15', 'Pendiente', 'Daño de reóstato de arranque ITALTEC por conexión errónea, pendiente reparación y realizar pruebas funcionales'),
    (20, 'Hacer uso de los equipos y herramientas sin autorización y/o sin conocer su adecuado manejo', 'Francy Liliana Lopez Rojas', 20231574007, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-10-15', 'Pendiente', 'Daño de reóstato de arranque ITALTEC por conexión errónea, pendiente reparación y realizar pruebas funcionales'),
    (21, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20201572055, 'Laboratorio de Software Aplicado 1 - Electricidad', '2025-12-12', 'Pendiente', 'Reposición de fichas LEGO rotas (6) ref. 4514553 y (40) ref. 4121715'),
    (22, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20221572031, 'Laboratorio de Software Aplicado 1 - Electricidad', '2025-12-12', 'Pendiente', 'Reposición de fichas LEGO rotas (6) ref. 4514553 y (40) ref. 4121715'),
    (23, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20222572025, 'Laboratorio de Software Aplicado 1 - Electricidad', '2025-12-05', 'Pendiente', 'Reposición de fichas LEGO extraviadas (120) ref. 4121715'),
    (24, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20211572003, 'Laboratorio de Software Aplicado 1 - Electricidad', '2025-12-05', 'Pendiente', 'Reposición de fichas LEGO extraviadas (120) ref. 4121715'),
    (25, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20222673046, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-12-05', 'Pendiente', 'reposición de sonda de prueba RIGOL, por daño de la misma'),
    (26, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20221673035, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-12-05', 'Pendiente', 'reposición de sonda de prueba RIGOL, por daño de la misma'),
    (27, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20201573086, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-12-05', 'Pendiente', 'Reposición de sonda de prueba RIGOL, por daño de la misma'),
    (28, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'Francy Liliana Lopez Rojas', 20232673005, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-12-05', 'Pendiente', 'Reposición de sonda de prueba RIGOL, por daño de la misma'),
    (29, 'Abandono de los equipos prestados o no devolución en los plazos establecidos', 'Francy Liliana Lopez Rojas', 20191573107, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-11-22', 'Pendiente', 'Inasistencia a práctica libre y/o no cancelación en los tiempos establecidos'),
    (30, 'Abandono de los equipos prestados o no devolución en los plazos establecidos', 'Francy Liliana Lopez Rojas', 20202673061, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-11-22', 'Pendiente', 'Inasistencia a práctica libre y/o no cancelación en los tiempos establecidos'),
    (31, 'Abandono de los equipos prestados o no devolución en los plazos establecidos', 'Francy Liliana Lopez Rojas', 20202673092, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-11-22', 'Pendiente', 'Inasistencia a práctica libre y/o no cancelación en los tiempos establecidos'),
    (32, 'Abandono de los equipos prestados o no devolución en los plazos establecidos', 'Francy Liliana Lopez Rojas', 20201573097, 'Laboratorio Aplicado de Máquinas Eléctricas', '2025-11-22', 'Pendiente', 'Inasistencia a práctica libre y/o no cancelación en los tiempos establecidos'),
    (33, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'JUAN FELIPE MOYANO FONSECA', 20251180016, 'Laboratorio De Microbiolog¡a Y Bioprospecci¢n Medioambiental', '2026-02-25', 'Pendiente', 'Varilla agitadora de vidrio borde paleta 19cm'),
    (34, 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios', 'JUAN FELIPE MOYANO FONSECA', 20251180117, 'Laboratorio De Microbiolog¡a Y Bioprospecci¢n Medioambiental', '2026-02-25', 'Pendiente', 'Rompió una Varilla agitadora de vidrio borde paleta 19CM'),
    (1001, 'Uso indebido de laboratorio', 'Coordinación Paiba', 20241081011, 'Centro de Geoprocesamiento/Aula Especializada', '2026-01-15', 'Pendiente', 'Caso piloto local para validación de aprobación por facultad Paiba.'),
    (1002, 'Incumplimiento de protocolo', 'Coordinación Paiba', 20241081012, 'Laboratorio Observatorio Astronómico', '2026-01-16', 'POR SALDAR', 'Caso piloto local para validación de cierre por facultad Paiba.'),
    (1003, 'Daño de material', 'Coordinación Vivero', 20251180018, 'Laboratorio De Microbiología Y Bioprospección Medioambiental', '2026-01-17', 'POR SALDAR', 'Caso piloto local para validación de aprobación visible en Vivero.');

UPDATE coordinador_laboratorio c
SET nombre = s.nombre,
    correo = s.correo,
    id_facultad = f.id_facultad,
    numero_resolucion_coordinador = s.numero_resolucion_coordinador,
    soporte_resolucion = s.soporte_resolucion,
    nombre_u = s.nombre_u
FROM tmp_seed_coordinadores s
JOIN facultad f ON f.nombre = s.facultad_nombre
WHERE c.documento = s.documento
    AND NOT EXISTS (
            SELECT 1
            FROM coordinador_laboratorio c_conflict
            WHERE c_conflict.documento <> c.documento
                AND (
                        LOWER(c_conflict.correo) = LOWER(s.correo)
                        OR c_conflict.nombre_u = s.nombre_u
                )
    );

INSERT INTO coordinador_laboratorio (
    documento,
    nombre,
    correo,
    id_facultad,
    numero_resolucion_coordinador,
    soporte_resolucion,
    nombre_u
)
SELECT
    s.documento,
    s.nombre,
    s.correo,
    f.id_facultad,
    s.numero_resolucion_coordinador,
    s.soporte_resolucion,
    s.nombre_u
FROM tmp_seed_coordinadores s
JOIN facultad f ON f.nombre = s.facultad_nombre
LEFT JOIN coordinador_laboratorio by_document ON by_document.documento = s.documento
LEFT JOIN coordinador_laboratorio by_email ON LOWER(by_email.correo) = LOWER(s.correo)
LEFT JOIN coordinador_laboratorio by_user ON by_user.nombre_u = s.nombre_u
WHERE by_document.documento IS NULL
  AND by_email.documento IS NULL
  AND by_user.documento IS NULL;

INSERT INTO coordinador_facultad (documento, id_facultad)
SELECT DISTINCT s.documento, f.id_facultad
FROM tmp_seed_coordinadores s
JOIN facultad f ON f.nombre = s.facultad_nombre
ON CONFLICT DO NOTHING;

UPDATE auth a
SET correo = s.correo,
    tipo = s.auth_tipo
FROM tmp_seed_coordinadores s
WHERE a.documento = s.nombre_u;

INSERT INTO auth (documento, password, tipo, password_cambiado, correo)
SELECT
    s.nombre_u,
    crypt('PazYSalvo2026!', gen_salt('bf', 12)),
    s.auth_tipo,
    FALSE,
    s.correo
FROM tmp_seed_coordinadores s
LEFT JOIN auth a ON a.documento = s.nombre_u
WHERE a.documento IS NULL;

UPDATE usuario u
SET codigo = s.codigo,
    nombre = LEFT(s.nombre, 100),
    correo = s.correo,
    estado = s.estado,
    carrera = LEFT(COALESCE(s.carrera, ''), 100)
FROM tmp_seed_usuarios s
WHERE u.documento = s.documento
    AND NOT EXISTS (
            SELECT 1
            FROM usuario u_conflict
            WHERE u_conflict.documento <> u.documento
                AND LOWER(u_conflict.correo) = LOWER(s.correo)
    );

INSERT INTO usuario (documento, codigo, nombre, correo, estado, carrera)
SELECT
    s.documento,
    s.codigo,
    LEFT(s.nombre, 100),
    s.correo,
    s.estado,
    LEFT(COALESCE(s.carrera, ''), 100)
FROM tmp_seed_usuarios s
LEFT JOIN usuario by_document ON by_document.documento = s.documento
LEFT JOIN usuario by_email ON LOWER(by_email.correo) = LOWER(s.correo)
WHERE by_document.documento IS NULL
  AND by_email.documento IS NULL;

UPDATE auth a
SET correo = s.correo,
    tipo = s.tipo
FROM tmp_seed_usuarios s
WHERE a.documento = s.documento;

INSERT INTO auth (documento, password, tipo, password_cambiado, correo)
SELECT
    s.documento,
    crypt('PazYSalvo2026!', gen_salt('bf', 12)),
    s.tipo,
    TRUE,
    s.correo
FROM tmp_seed_usuarios s
LEFT JOIN auth a ON a.documento = s.documento
WHERE a.documento IS NULL;

INSERT INTO multas (
    id,
    cat_multa,
    nombre_laboratorista,
    cc_laboratorista,
    cod_multado,
    ual,
    fecha_multa,
    con_estado_multa,
    obs_multa,
    n_usuario
)
SELECT
    s.id,
    s.cat_multa,
    s.nombre_laboratorista,
    NULL,
    s.cod_multado,
    s.ual,
    s.fecha_multa,
    s.con_estado_multa,
    s.obs_multa,
    NULL
FROM tmp_seed_multas s
ON CONFLICT (id) DO UPDATE
SET cat_multa = EXCLUDED.cat_multa,
    nombre_laboratorista = EXCLUDED.nombre_laboratorista,
    cod_multado = EXCLUDED.cod_multado,
    ual = EXCLUDED.ual,
    fecha_multa = EXCLUDED.fecha_multa,
    con_estado_multa = EXCLUDED.con_estado_multa,
    obs_multa = EXCLUDED.obs_multa,
    cc_laboratorista = EXCLUDED.cc_laboratorista,
    n_usuario = EXCLUDED.n_usuario;

SELECT setval(
    pg_get_serial_sequence('multas', 'id'),
    GREATEST(COALESCE((SELECT MAX(id) FROM multas), 1), 1),
    TRUE
);

-- Limpieza para permitir pruebas de registro con el estudiante 1023375159.
DELETE FROM auth WHERE documento = '1023375159';
DELETE FROM usuario WHERE documento = '1023375159';

-- Limpieza para permitir pruebas de registro docente con el documento 79520182.
DELETE FROM coordinador_facultad WHERE documento = '79520182';
DELETE FROM auth WHERE documento = 'labsistemastecno' OR documento = '79520182';
DELETE FROM coordinador_laboratorio WHERE documento = '79520182' OR nombre_u = 'labsistemastecno';
DELETE FROM usuario WHERE documento = '79520182';