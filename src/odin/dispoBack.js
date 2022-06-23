/*
 Aplicar ESLint
 - Tamaño máximo de función: 100 líneas
 - Anidamiento máximo: 5

 Detectar globalización

*/

require("./config/environment");
const utils = require("./utils/utils");
const os = require("os");
const cluster = require("cluster");
const communication = require("./communication");
const restricciones = require("./restriccciones");
const agencia = require("./agencia");
const descuentos = require("./descuentos");
const cron = require("./utils/cron");
const gastos = require("./gastos");

global.HOSTNAME = os.hostname();
cron.activarCron();

if (cluster.isMaster) {
  const dns = require("dns");
  dns.lookup(global.HOSTNAME, function (err, ipWorker) {
    if (err) ipWorker = global.HOSTNAME;
    utils.creaWorkers(cluster, ipWorker);
  });

  cluster.on("exit", function (worker) {
    console.log("worker " + worker.process.pid + " died");
    setTimeout(function () {
      utils.reiniciaWorkers(cluster, worker);
    }, 5000);
  });
} else {
  var events = require("events");
  var eventLista = new events.EventEmitter();
  const merge = require("merge");
  const NodeCache = require("node-cache");
  const Database = require("./database.js");
  var codigos = {};
  const idWorker = process.env.workerId; // ip del worker
  var id = "id_Worker_" + process.env.id;
  var Set = require("collections/set");
  var peso = { T: 3, A: 2, D: 1 };
  var pesoReg = { "": 1, OB: 1, RO: 1, BB: 2, HB: 3, FB: 4, TI: 5, FA: 6, FI: 6 };
  var BSON = require("bson");
  var bson = BSON;
  const channelCodigos = communication.createConnection("sub", idWorker);
  channelCodigos.connection("tcp" + global.NODE_URL_CODIGOS + global.SUBSCRIBE_PORT);
  console.log(idWorker, " subscrito a " + global.NODE_URL_CODIGOS + global.SUBSCRIBE_PORT);
  channelCodigos.subscriber("");
  const requestCodigos = communication.createConnection("req", undefined);
  requestCodigos.connection("tcp" + global.NODE_URL_CODIGOS + global.REQUEST_PORT);
  console.log(idWorker, " req a " + global.NODE_URL_CODIGOS + global.REQUEST_PORT);

  const database = Database.create(() => {
    console.log(idWorker, " enviando peticion de Inicio de Carga de datos en memoria....");
    requestCodigos.sendMessage("Inicio");
  });

  var numPeticiones = 0;
  var petisProcesando = 0;
  var socket = [];
  var cache = new NodeCache({
    stdTTL: global.REQUEST_TTL,
    checkperiod: global.REQUEST_CHECKPERIOD,
    errorOnMissing: false,
    useClones: false,
  });
  var posKeys = 0; //posicion del array y cache
  var arrayClaves = []; // guardaremos en un array las claves de las petis ( q ser� un n�mero), para poder acceder
  var reinicio = 0; //para controlar cuando estemos saturados

  for (let i = 0; i < global.NODE_URL_BROKERS.length; i++)
    socket.push(communication.createConnection("dealer", idWorker + "-" + i));

  requestCodigos.receiveMessage(args => {
    const tipo = args[0];
    const data = args[1];
    if (data) merge(codigos, JSON.parse(data));
    if (tipo == "Inicio") {
      for (let i = 0; i < global.NODE_URL_BROKERS.length; i++) {
        socket[i].connection("tcp" + global.NODE_URL_BROKERS[i] + global.PROCESAR_PORT);
        console.log(
          idWorker,
          " ... inicializacion completa! Router en " + global.NODE_URL_BROKERS[i] + global.PROCESAR_PORT,
        );
      }
      requestCodigos.disconnection("tcp" + global.NODE_URL_CODIGOS + global.REQUEST_PORT);
    }
  });

  var ping = Date.now();
  channelCodigos.receiveMessage(args => {
    ping = Date.now();
    const data = args[0];
    if (data != "ping") {
      merge(codigos, JSON.parse(data));
      console.log(idWorker, "Nuevos codigos en worker recibidos! ", new Date());
    }
  });

  setInterval(() => {
    if (Date.now() - ping > 1000 * 60 * 21) {
      channelCodigos.disconnection("tcp" + global.NODE_URL_CODIGOS + global.SUBSCRIBE_PORT);
      channelCodigos.connection("tcp" + global.NODE_URL_CODIGOS + global.SUBSCRIBE_PORT);
      console.error("subscriber fail");
    }
  }, 1000 * 60 * 15);

  for (let i = 0; i < socket.length; i++)
    (socket_id => {
      console.log("CONECTADO SOCKET " + socket_id + "--" + i);
      socket[socket_id].receiveMessage(function (args) {
        var msg = { scope: JSON.parse(args.getLast()) };
        msg.scope["dur"] = Date.now();
        msg.scope.entFechSis = new Date(msg.scope.entFechSis);
        msg.scope.entFecEntr = new Date(msg.scope.entFecEntr);
        msg.scope.entFecSald = new Date(msg.scope.entFecSald);
        msg.scope.FecSald = utils.addDiasFecha(msg.scope.entFecSald, -1);
        msg.scope.entFechPro = new Date(msg.scope.entFechPro);
        msg.scope.entTimeIni = Date.now();
        if (msg.scope.timetoOut) msg.scope.timetoOut = Math.round((msg.scope.timetoOut / 1000) * 100) / 100;
        // para pasar a segundos y redondear a dos decimales
        else msg.scope.timetoOut = global.REQUEST_TTL;

        numPeticiones += msg.scope.entHoteles.length * msg.scope.entNumNocs;
        tratarDispo(msg.scope, function (error, results, status) {
          numPeticiones -= msg.scope.entHoteles.length * msg.scope.entNumNocs;
          petisProcesando--;
          results.status = status; // para enviarle al front el estado de la peticion
          args.setLast(JSON.stringify(results));
          socket[socket_id].sendMessage(args);
        });
      });
    })(i);

  process.on("exit", () => {
    channelCodigos.disconnection();
    for (let i = 0; i < socket.length; i++)
      socket[i].disconnection("tcp" + global.NODE_URL_BROKERS[i] + global.PROCESAR_PORT);
  });

  // Control de prioridad de procesado segun entTimemax
  eventLista.on("Next", () => {
    utils.getNextPeti(cache, petisProcesando, global.MAX_PETIS_PROCESS, arrayClaves, () => {
      eventLista.emit("Next");
    });
  });

  function tratarDispo(scope, callback) {
    arrayClaves.push(posKeys);
    cache.set(
      "" + posKeys,
      {
        scope: scope,
        timeOut: () => {
          //Superado el tiempo para poder empezar a calcular dispo
          petisProcesando++;
          callback(
            null,
            {
              KO: [],
              timeout: scope.entHoteles,
              hoteles: {},
            },
            "TO",
          );
          console.log(
            scope.dur + "\t" + petisProcesando + "\t-1\t-1\t-1\t-1\t" + (Date.now() - scope.dur) + "\t" + id + "\t" + numPeticiones + "\t" + cache.getStats().keys + "\t" + Object.keys(scope.entNmPaxes).length + "\t" + "TIMEOUT",
          );
        },
        exec: () => {
          petisProcesando++;
          //scope.entHoteles = scope.entHoteles.map(Number);
          const databaseTime = Date.now();
          database.findPlanning(
            new Date(scope.entFecEntr),
            scope.entHoteles,
            scope.entNumNocs,
            (error, results, databaseOrigin) => {
              const processTime = Date.now();
              if (error) {
                callback(
                  null,
                  {
                    KO: [],
                    timeout: scope.entHoteles,
                    hoteles: {},
                  },
                  "DB_ERROR",
                );
                console.error(error, scope);
                console.log(
                  scope.dur + "\t" + petisProcesando + "\t" + scope.entHoteles.length * scope.entNumNocs + "\t" + 0 + "\t" + Date.now() - processTime + "\t" + processTime - databaseTime + "\t" + (Date.now() - scope.dur) + "\t" + id + "\t" + numPeticiones + "\t" + cache.getStats().keys + "\t" + Object.keys(scope.entNmPaxes).length + "\t" + "DB_ERROR" + "\t" + databaseOrigin,
                );
                eventLista.emit("Next");
              } else
                procesarDispo(results, scope, databaseOrigin, availability => {
                  callback(null, availability, "OK");
                  let resultsWithAvailability = 0;
                  if (databaseOrigin == "mongo") resultsWithAvailability = results.length;
                  else if (databaseOrigin == "redis")
                    results.forEach(item => {
                      if (item) resultsWithAvailability++;
                    });

                  console.log(
                    scope.dur +
                    "\t" +
                    petisProcesando +
                    "\t" +
                    scope.entHoteles.length * scope.entNumNocs +
                    "\t" +
                    resultsWithAvailability +
                    "\t" +
                    (Date.now() - processTime) +
                    "\t" +
                    (processTime - databaseTime) +
                    "\t" +
                    (Date.now() - scope.dur) +
                    "\t" +
                    id +
                    "\t" +
                    numPeticiones +
                    "\t" +
                    cache.getStats().keys +
                    "\t" +
                    Object.keys(scope.entNmPaxes).length +
                    "\t" +
                    "OK" +
                    "\t" +
                    databaseOrigin,
                  );
                  eventLista.emit("Next");
                });
            },
          );
        },
      },
      scope.timetoOut,
      (err, success) => {
        if (success == false) console.error("ERROR CACHE SET: " + err + "--" + success);
      },
    );
    posKeys++;
    reinicio++;
    // por si en algun remoto caso nos estancamos y no seguimos procesando petis , esto har� que poco a poco se destrabe
    if (
      reinicio % 10 < 2 || !global.MAX_PETIS_PROCESS || (arrayClaves.length > 0 && petisProcesando < global.MAX_PETIS_PROCESS)
    )
      //Para poner un tope a las peticiones que puede procesar, en momentos de picos
      eventLista.emit("Next");
  }

  // tras X segundos reseteamos la variable  para que entre en el if si las otras condiciones no se cumplen (estamos saturados)
  setInterval(() => {
    reinicio = 0;
  }, 1000 * 10);

  // tras X segundos reseteamos la variable que su valor siempre sea el minimo posible
  setInterval(() => {
    posKeys = 0;
  }, 1000 * 11 * 60);

  cache.on("expired", (key, value) => {
    value.timeOut();
  });

  function procesarDispo(infoDispo, scope, databaseOrigin, callback) {
    var resDispoHoteles = {};
    var setHotelesTO = new Set();

    infoDispo.forEach(function (dispoTratamiento) {
      if (databaseOrigin == "mongo") dispoTratamiento = bson.deserialize(dispoTratamiento);
      else if (databaseOrigin == "redis") {
        if (!dispoTratamiento) return;

        dispoTratamiento = JSON.parse(dispoTratamiento);
      }
      if (Date.now() - scope.entTimeIni > scope.entTimemax - 20 - 80) setHotelesTO.add(dispoTratamiento.hot);
      else {
        var afpa = dispoTratamiento.afpa.split(",");
        dispoTratamiento.afi = afpa[0];
        dispoTratamiento.pais = afpa[1];
        scope.PVPVinculado = calcPVPVinculado(dispoTratamiento.hot, scope.entFechSis);
        procesarDispoHotel(dispoTratamiento, scope, resDispoHoteles);
      }
    });
    finalizacion(scope, resDispoHoteles);
    callback({
      KO: [],
      timeout: setHotelesTO.toArray(),
      hoteles: resDispoHoteles,
    });
  }

  function procesarDispoHotel(dispoTratamiento, scope, resDispoHoteles) {
    //Packs disponibles en MONGO segun habitacion
    var diferentesPax = {};
    Object.keys(dispoTratamiento.habs).forEach(function (codHab) {
      if (codigos.habitaciones[codHab.trim()]) {
        var p = codigos.habitaciones[codHab.trim()].adu + "-" + codigos.habitaciones[codHab.trim()].chi;
        if (!diferentesPax.hasOwnProperty(p)) diferentesPax[p] = [];
        diferentesPax[p].push(codHab);
      }
    });
    if (!scope.entNmPaxes)
      // Parche temporal
      scope.entNmPaxes = { "1-0": 1 };

    //TODO eliminar packs menores
    Object.keys(scope.entNmPaxes)
      .sort()
      .forEach(function (codPaxPeticion) {
        var resDelPaxOriginal = null;
        var arrayPax = Object.keys(diferentesPax).sort();
        for (var i = 0; i < arrayPax.length; i++) {
          var pax = arrayPax[i];
          var paxAdultos = parseInt(pax.split("-")[0]);
          var paxNinos = parseInt(pax.split("-")[1]);
          var paxPetAdultos = parseInt(codPaxPeticion.split("-")[0]);
          var paxPetNinos = parseInt(codPaxPeticion.split("-")[1]);
          //Si el pack se ajusta a la peticion
          if (utils.isPaxAccepted(paxAdultos, paxNinos, paxPetAdultos, paxPetNinos)) {
            var infoHabitacion = paxAdultos + paxNinos;
            var arrayHabitaciones = diferentesPax[pax]; // Habitaciones que pertencen a este pack
            var numHabitaciones = (scope.entNmPaxes && scope.entNmPaxes[codPaxPeticion]) || scope.entNumHabs;
            var resBusqueda = procesarDispoHotelPorPax(
              dispoTratamiento,
              scope,
              numHabitaciones,
              arrayHabitaciones,
              infoHabitacion,
            );

            if (codPaxPeticion == pax) resDelPaxOriginal = resBusqueda;
            var hayHabitacionDispo = false;
            arrayHabitaciones.forEach(function (codHab) {
              if (resBusqueda[codHab].hayDispo) hayHabitacionDispo = true;
            });
            if (hayHabitacionDispo) {
              resDelPaxOriginal = null;
              insertarDispo(resBusqueda, codPaxPeticion, pax, arrayHabitaciones);
              break; // Deja de buscar mas paxes.
            }
          }
        }
        if (resDelPaxOriginal)
          insertarDispo(resDelPaxOriginal, codPaxPeticion, codPaxPeticion, diferentesPax[codPaxPeticion]);
      });

    function insertarDispo(resBusqueda, codPaxPeticion, codPaxOrigen, arrayHabitaciones) {
      var objHotel = resDispoHoteles[dispoTratamiento.hot];
      if (!objHotel) {
        objHotel = {};
        resDispoHoteles[dispoTratamiento.hot] = objHotel;
      }
      var objPax = objHotel[codPaxPeticion];
      if (!objPax) {
        objPax = {};
        objHotel[codPaxPeticion] = objPax;
      }
      var inventarioCogido = {};
      arrayHabitaciones.forEach(function (codHab) {
        // Se incluye la Habitacion si es de la busqueda del pax original, o tiene dispo
        if (resBusqueda[codHab].hayDispo || codPaxPeticion == codPaxOrigen) {
          merge.recursive(objPax, resBusqueda[codHab].dispo);
          merge.recursive(inventarioCogido, resBusqueda[codHab].dispoCogida);
        }
      });
      Object.keys(inventarioCogido).forEach(function (origen) {
        if (dispoTratamiento.inv[origen].est != "V") dispoTratamiento.inv[origen].nHab -= inventarioCogido[origen];
      });
    }
  }

  function procesarDispoHotelPorPax(
    dispoTratamiento,
    scope,
    numHabitaciones,
    arrayHabitacionesPeticion,
    infoHabitacion,
  ) {
    var resBusqueda = {};
    dispoTratamiento.dia = new Date(dispoTratamiento.dia);
    var diasAntelacion = (dispoTratamiento.dia.getTime() - scope.entFechPro.getTime()) / 86400000;
    var offset = Math.round((dispoTratamiento.dia.getTime() - scope.entFecEntr.getTime()) / 86400000);
    const dsctEmpBase = scope.entAgraFit[dispoTratamiento.hot] && scope.entAgraFit[dispoTratamiento.hot].dtoEmp && scope.entAgraFit[dispoTratamiento.hot].dtoEmp[offset];
    var dsctosGenerales = [];
    var afilAge = scope.entAfilAge == "VE" ? dispoTratamiento.afi : scope.entAfilAge;
    var gruposAgencia = scope.entGrpsAge && scope.entGrpsAge[afilAge];
    var isrest = dispoTratamiento.est;

    dispoTratamiento.dtos && dispoTratamiento.dtos.forEach(function (dscto) {
      let push = true;
      if (dscto.rest)
        // restricciones
        // Dias / Habitaciones
        push = descuentos.calculaDescuento(
          dscto,
          numHabitaciones,
          scope.entNumNocs,
          diasAntelacion,
          dispoTratamiento.afi,
          afilAge,
          scope.entHoraPro,
          scope.entFechPro,
          gruposAgencia,
          scope.entCobolAg,
        );

      if (push) dsctosGenerales.push(dscto);
    });

    arrayHabitacionesPeticion.forEach(function (codHabitacion) {
      resBusqueda[codHabitacion] = { hayDispo: false, dispoCogida: {}, dispo: {} };
      var objHabitacion = dispoTratamiento.habs[codHabitacion];
      Object.keys(objHabitacion).forEach(function (codTarifa) {
        if (scope.entCodTari && scope.entCodTari != codTarifa) return;

        var objTarifa = objHabitacion[codTarifa];
        var infoTarifa = dispoTratamiento.tars[codTarifa];
        if (!infoTarifa.divN) {
          var tar = infoTarifa.split(",");
          infoTarifa = {
            divN: tar[0],
            iIva: tar[1] == "S",
            pIva: tar[2],
            pPor: tar[3],
            comi: tar[4],
            comS: tar[5],
            aumA: tar[6],
            fit: tar[7] == "S",
            regMin: pesoReg[tar[10]],
          };
          if (tar[8] != "") infoTarifa.agen = tar[8].split("#");
          if (tar[9] != "") infoTarifa.grag = tar[9];
        }

        //TODO agregar como propiedad de infoTarifa para no tener que recalcularla pringado
        var divisaDestino = infoTarifa.divN != "EU" && scope.entDivPerm && scope.entDivPerm.indexOf(infoTarifa.divN) > -1 ? infoTarifa.divN : "EU";

        // Comprobacion restricciones de tarifa
        if (scope.entAgraFit[dispoTratamiento.hot].fit == "N" && infoTarifa.fit) return;
        if (infoTarifa.agen && infoTarifa.agen.indexOf(scope.entCobolAg) == -1) return;
        if (infoTarifa.grag && (!gruposAgencia || !gruposAgencia.hasValue(infoTarifa.grag))) return;

        let aumentado_general = parseInt(scope.entAgraFit[dispoTratamiento.hot].agral);
        if (aumentado_general == 0) aumentado_general = scope.entAumFich;

        var ratioAumAgencia = agencia.getRatioAumAgencia(
          codigos.tarifas[dispoTratamiento.afi + codTarifa.trim()],
          infoTarifa,
          scope.entAumefit,
          scope.entAumOfit,
          scope.entAumInt5,
          scope.entAgraFit,
          dispoTratamiento.hot,
          dispoTratamiento.pais,
          scope.PVPVinculado,
          scope.entNetas,
        );
        var porcComAgencia = agencia.getComisionAgencia(
          codigos.comEspeciales[dispoTratamiento.hot],
          codigos.comEspeciales[dispoTratamiento.hot + "#" + dispoTratamiento.afi],
          codigos.comEspeciales[dispoTratamiento.hot + "#" + scope.entCobolAg + "#" + scope.entAfilAge],
          dispoTratamiento.pais,
          scope.entComAgen[afilAge],
          infoTarifa.comi,
          infoTarifa.fit,
          aumentado_general,
          scope.PVPVinculado,
          scope.entNetas,
        );

        if (!dispoTratamiento.inv[objTarifa.ori].est) {
          var inv = dispoTratamiento.inv[objTarifa.ori].split(",");
          dispoTratamiento.inv[objTarifa.ori] = { nHab: inv[0], est: inv[1] };
        }

        var gastosCalc = gastos.calcGastosCalc(
          codigos.tarifas[dispoTratamiento.afi + codTarifa],
          codigos.gastosCancelacionMarca,
          dispoTratamiento.dia,
          dispoTratamiento.afi,
          dispoTratamiento.pais,
          dispoTratamiento.gtosT,
          dispoTratamiento.gtos,
          codTarifa,
          scope.entNumNocs,
        );
        //TODO:calcular precios RO OB BB

        Object.keys(objTarifa).forEach(function (codRegimen) {
          var hayRestric = true;
          if (codRegimen == "ori") return;
          var estado = dispoTratamiento.inv[objTarifa.ori].est; // P:peticion || C:cupo || V:venta libre TODO:Eliminar variable
          var precioAumNorm = calcPrecioUnitario(
            dispoTratamiento.afi,
            objTarifa[codRegimen],
            infoHabitacion,
            infoTarifa,
          );
          var precioAumentado = calcPrecioDivisa(
            dispoTratamiento.afi,
            objTarifa[codRegimen],
            infoHabitacion,
            infoTarifa,
            divisaDestino,
          );

          const precioNetoHotel = Math.round(precioAumentado.precio + precioAumentado.iva);

          //Indicamos si debemos quitar el IVA los clientes de paises diferentes al del hotel (Solo aplica a ciertos paises del hotel)
          if (scope.entAgraFit[dispoTratamiento.hot].pvpiva == undefined) pvpiva = true;
          else pvpiva = scope.entAgraFit[dispoTratamiento.hot].pvpiva;

          if (infoTarifa.regMin > pesoReg[codRegimen]) return;

          if (isrest)
            hayRestric = restricciones.restricciones(
              isrest,
              codHabitacion,
              codTarifa,
              codRegimen,
              scope.entNumNocs,
              dispoTratamiento.dia,
              scope.entFecEntr,
              scope.FecSald,
            );
          if (!hayRestric) return;

          resBusqueda[codHabitacion].precioConAlternativa = scope.entPreAlte; //TODO:Eliminar variable

          var numHab = Math.min(dispoTratamiento.inv[objTarifa.ori].nHab, numHabitaciones);
          numHab < 0 && (numHab = 0);

          var estado = dispoTratamiento.inv[objTarifa.ori].est; // P:peticion || C:cupo || V:venta libre TODO:Eliminar variable
          var precioAumNorm = calcPrecioUnitario(
            dispoTratamiento.afi,
            objTarifa[codRegimen],
            infoHabitacion,
            infoTarifa,
          );
          var precioAumentado = calcPrecioDivisa(
            dispoTratamiento.afi,
            objTarifa[codRegimen],
            infoHabitacion,
            infoTarifa,
            divisaDestino,
          );

          var PVPVinculadoTarifa = 0;

          if (scope.PVPVinculado) PVPVinculadoTarifa = precioAumentado.precio + precioAumentado.iva;

          if (infoTarifa.aumA != "N") PVPVinculadoTarifa /= ratioAumAgencia.PVP;

          precioAumNorm /= ratioAumAgencia.agencia;
          precioAumentado.precio /= ratioAumAgencia.agencia;

          precioAumentado.iva /= ratioAumAgencia.agencia;
          var impComision = 0;

          if (
            infoTarifa.comS == "T" || (infoTarifa.comS != "T" && (codRegimen == "OB" || codRegimen == "RO" || (!objTarifa["RO"] && !objTarifa["OB"])))
          ) {
            // Sobre el total
            impComision = agencia.comisionAgencia(afilAge, impComision, precioAumentado, porcComAgencia);
            if (scope.entNetas) precioAumentado.precio -= impComision;
          } else {
            // Sobre el alojamiento
            var imporSoloAlojamiento = objTarifa["RO"] || objTarifa["OB"] || 0;
            imporSoloAlojamiento = calcPrecioDivisa(
              dispoTratamiento.afi,
              imporSoloAlojamiento,
              infoHabitacion,
              infoTarifa,
              divisaDestino,
            );
            imporSoloAlojamiento /= ratioAumAgencia.agencia;
            var otroServ = precioAumentado.precio - imporSoloAlojamiento;
            impComision = agencia.comisionAgencia(afilAge, impComision, precioAumentado, porcComAgencia);
            if (scope.entNetas) imporSoloAlojamiento -= impComision;
            precioAumentado.precio = imporSoloAlojamiento + otroServ;
          }

          // Si hay que quitar el IVA, lo quitamos del precio NETO.
          if (infoTarifa.iIva && !pvpiva) precioAumentado.precio /= 1 + infoTarifa.pIva / 100;

          dsctosGenerales.forEach(function (dscto) {
            var PVPVinculado = PVPVinculadoTarifa;

            if (dscto.rest) {
              if (dscto.rest.habitac && dscto.rest.habitac.split(",").indexOf(codHabitacion) == -1) return;
              if (dscto.rest.tarifas && dscto.rest.tarifas.split(",").indexOf(codTarifa) == -1) return;
              if (dscto.rest.regimen && dscto.rest.regimen.split(",").indexOf(codRegimen) == -1) return;
            }

            if (dscto.porc || dscto.impo) {
              var impDescuentoNorm = 0;
              var impDescuento = 0;
              if (dscto.porc) {
                //En el caso de que el descuento sea <1 no se dar� la tarifa como reembolsable.
                resBusqueda[codHabitacion].precioConAlternativa = dscto.porc > 1;
                if (dscto.base == "A" || dscto.base == "D") {
                  var origenAlojamiento = objTarifa["RO"] || objTarifa["OB"];
                  if (origenAlojamiento) {
                    var precioAlojamiento = calcPrecioDivisa(
                      dispoTratamiento.afi,
                      origenAlojamiento,
                      infoHabitacion,
                      infoTarifa,
                      divisaDestino,
                    );
                    precioAlojamiento = precioAlojamiento.precio + precioAlojamiento.iva;
                    if (dscto.base == "A") {
                      impDescuentoNorm = (calcPrecioUnitario(dispoTratamiento.afi, origenAlojamiento, infoHabitacion, infoTarifa) * (1 - porcComAgencia / 100) * (dscto.porc / 100)) / ratioAumAgencia.agencia;
                      impDescuento = scope.entNetas ? (precioAlojamiento * (1 - porcComAgencia / 100) * (dscto.porc / 100)) / ratioAumAgencia.agencia : (precioAlojamiento * (dscto.porc / 100)) / ratioAumAgencia.agencia;
                      PVPVinculado -= precioAlojamiento * (dscto.porc / 100);
                    } else if (codRegimen != "OB" && codRegimen != "RO") {
                      var origenAlojamientoDesayuno = objTarifa["BB"];
                      if (origenAlojamientoDesayuno) {
                        var precioDesayuno = calcPrecioDivisa(
                          dispoTratamiento.afi,
                          origenAlojamientoDesayuno,
                          infoHabitacion,
                          infoTarifa,
                          divisaDestino,
                        );
                        precioDesayuno = precioDesayuno.precio + precioDesayuno.iva;
                        impDescuentoNorm =
                          ((calcPrecioUnitario(
                            dispoTratamiento.afi,
                            origenAlojamientoDesayuno,
                            infoHabitacion,
                            infoTarifa,
                          ) -
                            calcPrecioUnitario(dispoTratamiento.afi, origenAlojamiento, infoHabitacion, infoTarifa)) *
                            (1 - porcComAgencia / 100) *
                            (dscto.porc / 100)) /
                          ratioAumAgencia.agencia;

                        impDescuento = scope.entNetas
                          ? ((precioDesayuno - precioAlojamiento) * (1 - porcComAgencia / 100) * (dscto.porc / 100)) /
                          ratioAumAgencia.agencia
                          : ((precioDesayuno - precioAlojamiento) * (dscto.porc / 100)) / ratioAumAgencia.agencia;
                        PVPVinculado -= (precioDesayuno - precioAlojamiento) * (dscto.porc / 100);
                      }
                    }
                  }
                } else {
                  // T
                  impDescuentoNorm = precioAumNorm * (dscto.porc / 100);
                  impDescuento = precioAumentado.precio * (dscto.porc / 100);
                  PVPVinculado *= 1 - dscto.porc / 100;
                }

                dscto.impo = impDescuento; //TODO modificar
                if (PVPVinculado < 0) PVPVinculado = 0;
              }

              if (
                precioAumNorm > 2 && precioAumentado.precio > 2 && impDescuentoNorm > 0 && impDescuento > 0 && precioAumNorm - impDescuentoNorm > 2
              ) {
                var precio = (precioAumentado.precio - impDescuento) * (numHab || numHabitaciones);

                if (dsctEmpBase && !infoTarifa.fit) precio *= 1 - dsctEmpBase / 100;

                PVPVinculado = utils.roundTo2Decimals(PVPVinculado * (numHab || numHabitaciones));

                emitirTarifa(scope.entReembol, resBusqueda[codHabitacion], numHabitaciones, diasAntelacion, {
                  habit: codHabitacion,
                  regim: scope.entDesglos ? codRegimen : "**",
                  dia: "D" + offset,
                  tarifa: {
                    codTarifa: codTarifa,
                    codRegimen: codRegimen,
                    origen: objTarifa.ori,
                    precio: utils.roundTo2Decimals(precio),
                    divisa: divisaDestino,
                    precNorm: utils.roundTo2Decimals(precioAumNorm - impDescuentoNorm), // - impDescuentoNorm TODO: saca el precio mas barato y difiere con pandora, por ahora no se usara
                    dsctCtro: dscto.idor,
                    dsctBase: peso[dscto.base],
                    dsctPorc: dscto.porc,
                    dsctImpo: utils.roundTo2Decimals(dscto.impo),
                    dsctEmp: dsctEmpBase && !infoTarifa.fit ? dsctEmpBase : undefined,
                    PVPVinc: PVPVinculado,
                    numHab: numHab,
                    estado: estado,
                    precioNeto: precioNetoHotel,
                    rest: infoTarifa.rest,
                    comAgen: scope.entNetas ? 0 : utils.roundTo2Decimals(impComision),
                    comPorc: scope.entNetas ? 0 : porcComAgencia,
                    gastos: gastos.compGasTarifaMarcaFinal(scope.entNumNocs, [
                      dscto.gtos && JSON.parse("[" + dscto.gtos + "]"),
                      gastosCalc,
                    ]),
                  },
                });
              }
            }
          });

          if (
            precioAumNorm > 2 && precioAumentado.precio > 2 && scope.entPreAlte && resBusqueda[codHabitacion].precioConAlternativa
          ) {
            var precio = precioAumentado.precio * (numHab || numHabitaciones);

            if (dsctEmpBase && !infoTarifa.fit) precio *= 1 - dsctEmpBase / 100;

            PVPVinculadoTarifa = utils.roundTo2Decimals(PVPVinculadoTarifa * (numHab || numHabitaciones));

            emitirTarifa(scope.entReembol, resBusqueda[codHabitacion], numHabitaciones, diasAntelacion, {
              habit: codHabitacion,
              regim: scope.entDesglos ? codRegimen : "**",
              dia: "D" + offset,
              tarifa: {
                codTarifa: codTarifa,
                codRegimen: codRegimen,
                origen: objTarifa.ori,
                precioNeto: precioNetoHotel,
                precio: utils.roundTo2Decimals(precio),
                divisa: divisaDestino,
                precNorm: utils.roundTo2Decimals(precioAumNorm),
                dsctEmp: dsctEmpBase && !infoTarifa.fit ? dsctEmpBase : undefined,
                PVPVinc: PVPVinculadoTarifa,
                numHab: numHab,
                estado: estado,
                rest: infoTarifa.rest,
                comAgen: scope.entNetas === true ? 0 : utils.roundTo2Decimals(impComision), //TODO solo en RS netos utils.roundTo2Decimals(impComision),
                comPorc: scope.entNetas === true ? 0 : porcComAgencia, //TODO solo en RS netos porcComAgencia,
                gastos: gastosCalc,
              },
            });
          }
        }); // Bucle de Regimenes
      }); // Bucle de Tarifas
    }); // Bucle de Habitaciones
    return resBusqueda;
  }

  function emitirTarifa(entReembol, resBusqueda, numHabitaciones, diasAntelacion, objInfo) {
    var objHabit = resBusqueda.dispo[objInfo.habit];
    if (!objHabit) {
      objHabit = {};
      resBusqueda.dispo[objInfo.habit] = objHabit;
    }
    var objRegim = objHabit[objInfo.regim];
    if (!objRegim) {
      objRegim = {};
      objHabit[objInfo.regim] = objRegim;
    }

    if (entReembol == 0 || entReembol == 3) incluirTarifa(resBusqueda, numHabitaciones, objRegim, -1, objInfo);
    else if (entReembol == 1)
      if (gastos.entraEnGastos(objInfo.tarifa.gastos, diasAntelacion))
        incluirTarifa(resBusqueda, numHabitaciones, objRegim, 1, objInfo);
      else {
        incluirTarifa(resBusqueda, numHabitaciones, objRegim, 0, objInfo);
        incluirTarifa(resBusqueda, numHabitaciones, objRegim, 1, JSON.parse(JSON.stringify(objInfo)));
      }
    else if (entReembol == 2)
      if (gastos.entraEnGastos(objInfo.tarifa.gastos, diasAntelacion)) {
      } else incluirTarifa(resBusqueda, numHabitaciones, objRegim, 0, objInfo);
    else if (entReembol == 4)
      switch (gastos.entraEnGastos(objInfo.tarifa.gastos, diasAntelacion, true)) {
        case 1:
          incluirTarifa(resBusqueda, numHabitaciones, objRegim, 1, objInfo);
          break;
        case -1:
          incluirTarifa(resBusqueda, numHabitaciones, objRegim, 2, objInfo);
          break;
        default:
          incluirTarifa(resBusqueda, numHabitaciones, objRegim, 0, objInfo);
          incluirTarifa(resBusqueda, numHabitaciones, objRegim, 1, JSON.parse(JSON.stringify(objInfo)));
          incluirTarifa(resBusqueda, numHabitaciones, objRegim, 2, JSON.parse(JSON.stringify(objInfo)));
      }
  }

  function incluirTarifa(resBusqueda, numHabitaciones, objRegim, nr, objInfo) {
    var objCond;
    var objDia;
    objCond = objRegim["nr" + nr + "#rest0"];
    if (!objCond) {
      objCond = { dias: {} };
      objRegim["nr" + nr + "#rest0"] = objCond;
    }
    objDia = objCond.dias[objInfo.dia];
    if (!objDia) {
      objDia = { faltan: numHabitaciones, tarifas: [] };
      objCond.dias[objInfo.dia] = objDia;
    }
    calcularDia(resBusqueda, numHabitaciones, objInfo, objDia);
  }

  function calcularDia(resBusqueda, numHabs, objInfo, objDia) {
    var numHabsCogidas = 0;
    var tarInsertada = false;
    var auxTarifas = [];
    var tarPeticionInsertada = false;
    var faltan = Infinity;

    var insertarTarifa = function (numHabsFaltan, tarifa) {
      var numHabsACoger = numHabsFaltan < tarifa.numHab ? numHabsFaltan : tarifa.numHab;
      if (!tarifa.numHab || numHabs - numHabsACoger > 0) {
        // Solo se inserta la primera tarifa a peticion existente mas barata
        if (tarPeticionInsertada) return;
        tarifa.estado = "P";
        tarPeticionInsertada = true;
      }
      if (numHabs - numHabsACoger < faltan) faltan = numHabs - numHabsACoger;
      tarifa.numHab = numHabsACoger;
      resBusqueda.precioConAlternativa = !(tarifa.dsctPorc && tarifa.dsctPorc < 1);
      auxTarifas.push(tarifa);
    };

    for (var i = 0; i < objDia.tarifas.length; i++) {
      var tarExistente = objDia.tarifas[i];
      if (numHabs - numHabsCogidas == 0) break;

      if (!tarInsertada) {
        if (objInfo.tarifa.precNorm < tarExistente.precNorm) tarInsertada = true;
        else if (objInfo.tarifa.precNorm == tarExistente.precNorm)
          if (objInfo.tarifa.dsctBase && objInfo.tarifa.dsctBase > tarExistente.dsctBase) tarInsertada = true;
          else if (objInfo.tarifa.dsctBase && objInfo.tarifa.dsctBase == tarExistente.dsctBase)
            if (objInfo.tarifa.dsctPorc && objInfo.tarifa.dsctPorc > tarExistente.dsctPorc) tarInsertada = true;
            else if (objInfo.tarifa.dsctPorc && objInfo.tarifa.dsctPorc == tarExistente.dsctPorc)
              if (objInfo.tarifa.gastos[0] < tarExistente.gastos[0]) tarInsertada = true;

        tarInsertada && insertarTarifa(numHabs - numHabsCogidas, objInfo.tarifa);
      }

      if (objInfo.tarifa.origen != tarExistente.origen) insertarTarifa(numHabs - numHabsCogidas, tarExistente);
      else if (!tarInsertada) {
        insertarTarifa(numHabs - numHabsCogidas, tarExistente);
        tarInsertada = true;
      }
    }

    if (!tarInsertada && numHabs - numHabsCogidas > 0) insertarTarifa(numHabs - numHabsCogidas, objInfo.tarifa);
    objDia.faltan = faltan;
    objDia.tarifas = auxTarifas;
    resBusqueda.dispoCogida[objInfo.tarifa.origen] = numHabsCogidas;
    resBusqueda.hayDispo = resBusqueda.hayDispo || objDia.faltan == 0;
  }

  function calcPrecioUnitario(afil, regim, infoHabitacion, infoTarifa) {
    var prec = regim;
    if (infoTarifa.iIva) prec /= 1 + infoTarifa.pIva / 100;
    if (infoTarifa.pPor == "H") prec /= infoHabitacion;
    if (infoTarifa.divN != "EU") prec *= ratioCambio(afil, infoTarifa.divN, "EU");
    return prec;
  }

  function calcPrecioDivisa(afil, regim, infoHabitacion, infoTarifa, divisaDestino) {
    var prec = {};
    prec.precio = regim;

    var precio_base_sin_iva = prec.precio / (1 + infoTarifa.pIva / 100);

    prec.iva = prec.precio - precio_base_sin_iva;

    if (infoTarifa.pPor != "H") prec.precio *= infoHabitacion;

    //Si la tarifa tiene el IVA INCLUIDO se lo quitamos al precio. Sino Calculamos el precio el total del IVA
    if (infoTarifa.iIva) prec.precio -= prec.iva;
    else prec.iva = prec.precio * (infoTarifa.pIva / 100);

    if (infoTarifa.divN != divisaDestino) {
      prec.precio *= ratioCambio(afil, infoTarifa.divN, divisaDestino);
      prec.iva *= ratioCambio(afil, infoTarifa.divN, divisaDestino);
    }

    return prec;
  }

  function ratioCambio(afiliacion, divisaOrigen, divisaDestino) {
    var ratio = 1;
    divisaOrigen = divisaOrigen.trim() || "EU";
    divisaDestino = divisaDestino.trim() || "EU";
    if (divisaOrigen != divisaDestino) {
      if (divisaOrigen != "EU") {
        if (!codigos.divisas.hasOwnProperty(afiliacion + "#" + divisaOrigen)) {
          if (process.env.NODE_ENTORNO == "PROD" || true)
            console.log("ATENCION!! No existe la divisa ", divisaOrigen, " para la afiliacion ", afiliacion);
          return 0;
        }
        ratio *= codigos.divisas[afiliacion + "#" + divisaOrigen] || 1;
      }
      if (divisaDestino != "EU") {
        if (!codigos.divisas.hasOwnProperty(afiliacion + "#" + divisaDestino)) {
          if (process.env.NODE_ENTORNO == "PROD" || true)
            console.log("ATENCION!! No existe la divisa ", divisaDestino, " para la afiliacion ", afiliacion);
          return 0;
        }
        ratio /= codigos.divisas[afiliacion + "#" + divisaDestino] || 1;
      }
    }
    return ratio;
  }

  function calcPVPVinculado(hotel, fechaSist) {
    if (codigos.hotelesPVP["PVP"].indexOf(hotel) != -1) return true;

    if (codigos.hotelesPVP[hotel]) {
      var objPVPVinc = codigos.hotelesPVP[hotel][fechaSist.getDay()];
      if (objPVPVinc)
        if (
          fechaSist > utils.HHMMtoDate(objPVPVinc.hIni, fechaSist) &&
          fechaSist < utils.HHMMtoDate(objPVPVinc.hFin, fechaSist)
        )
          return true;
    }
    return false;
  }

  function finalizacion(scope, resultado) {
    Object.keys(resultado).forEach(function (codHotel) {
      let hotel = resultado[codHotel];
      Object.keys(hotel).forEach(function (codPax) {
        let pax = hotel[codPax];
        Object.keys(pax).forEach(function (codHab) {
          let hab = pax[codHab];
          Object.keys(hab).forEach(function (codReg) {
            let reg = hab[codReg];
            let precios = { rest0: {} };
            Object.keys(reg).forEach(function (codCond) {
              let arrCond = codCond.split("#");
              let objCond = reg[codCond];
              objCond.tieneDispo = Object.keys(objCond.dias).length == scope.entNumNocs;
              // Recalculo de los gastos y restricciones para cada dia
              objCond.gastos = null;
              let precioTotal = 0;

              Object.keys(objCond.dias).forEach(function (dia) {
                dia = objCond.dias[dia];
                if (dia.faltan > 0) objCond.tieneDispo = false;
                let min = 0;
                let precio = 0;

                dia.tarifas.forEach(function (tarifa, i) {
                  if (tarifa.estado != "P" && (precio > tarifa.precio || !precio)) {
                    precio = tarifa.precio;
                    min = i;
                  }
                });

                dia.tarifas = [dia.tarifas[min]];
                precioTotal += dia.tarifas[0].precio;
                dia.tarifas[0].estado = dia.tarifas[0].estado == "P" ? "PT" : objCond.tieneDispo ? "OK" : "PT";

                if (
                  !objCond.gastos || !objCond.gastos.length || (dia.tarifas[0].gastos && objCond.gastos[0] < dia.tarifas[0].gastos[0])
                )
                  objCond.gastos = dia.tarifas[0].gastos;
              });

              if (scope.entCadaDia && Object.keys(objCond.dias).length < scope.entNumNocs) delete reg[codCond];
              else if (!scope.entIncPeti && !objCond.tieneDispo) delete reg[codCond];
              else if (arrCond[0] == "nr-1") {
                arrCond[0] = "nr0";
                if (objCond.gastos)
                  if (scope.entReembol == 0) {
                    if (objCond.gastos && gastos.entraEnGastos(objCond.gastos, scope.entDiasAnt)) arrCond[0] = "nr1";
                  } else
                    switch (gastos.entraEnGastos(objCond.gastos, scope.entDiasAnt, true)) {
                      case 1:
                        arrCond[0] = "nr1";
                        break;
                      case -1:
                        arrCond[0] = "nr2";
                        break;
                    }

                reg[arrCond.join("#")] = reg[codCond];
                delete reg[codCond];
              } else {
                if (arrCond[0] == "nr0" && objCond.gastos && gastos.entraEnGastos(objCond.gastos, scope.entDiasAnt))
                  delete reg[codCond]; // NUNCA DEBERIA ENTRAR POR AQUI, SERIA UN ERROR.
                if (arrCond[0] == "nr1" && (!objCond.gastos || !gastos.entraEnGastos(objCond.gastos, scope.entDiasAnt)))
                  delete reg[codCond];
                if (
                  arrCond[0] == "nr2" &&
                  (!objCond.gastos || gastos.entraEnGastos(objCond.gastos, scope.entDiasAnt, true) != -1)
                )
                  delete reg[codCond];

                if (reg[codCond] && scope.entReembol == 4 && arrCond[0] !== "nr1") {
                  precios[arrCond[1]][arrCond[0]] = precioTotal;
                  if (precios[arrCond[1]]["nr0"] && precios[arrCond[1]]["nr2"])
                    if (precios[arrCond[1]]["nr0"] <= precios[arrCond[1]]["nr2"]) {
                      delete precios[arrCond[1]]["nr2"];
                      delete reg["nr2#" + arrCond[1]];
                    } else {
                      delete precios[arrCond[1]]["nr0"];
                      delete reg["nr0#" + arrCond[1]];
                    }
                }
              }
            });
            if (Object.keys(reg).length == 0) delete hab[codReg];
          });
          if (Object.keys(hab).length == 0) delete pax[codHab];
        });
        if (Object.keys(pax).length == 0) delete hotel[codPax];
      });
      if (Object.keys(hotel).length == 0) delete resultado[codHotel];
    });
  }

  Array.prototype.hasValue = function (v) {
    if (!v) return false;
    if (v instanceof Array)
      for (var i = 0; i < this.length; i++) {
        if (v.indexOf(this[i]) != -1) return true;
      }
    else if (this.indexOf(v) != -1) return true;

    return false;
  };

  Array.prototype.getLast = function (count) {
    if (!count) count = 0;
    return this[this.length - (1 + count)];
  };

  Array.prototype.setLast = function (value, count) {
    if (!count) count = 0;
    this[this.length - (1 + count)] = value;
  };
}
