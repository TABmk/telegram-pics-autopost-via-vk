/*
TODO ES6+
TODO 'request' => 'http'
TODO JSDocs with english description
TODO rewrite some cases
*/

// Подключение модуей и конфига
var TelegramBot = require('node-telegram-bot-api');
var config = require("./config.json");
var request = require("request");
var fs = require("fs");

// Включение бота и отключение получения обновлений
var bot = new TelegramBot(config.token, {
  polling: false
});

// Пара счетчиков ошибок
var noPicsErr = 0;
var toManyReqErr = 0;

// Проверяем, сущаествует ли наша локальная база
fs.exists("sent.json", function (exists) {
	// Если да - просто пишем об этом в консоль
	if(exists) {
		console.log('База отправленных картинок подключена');
	// Нет - создаем ее и так же пишем об этом
	}else {
		fs.writeFile("sent.json", '',{flag: 'wx'}, function (err, data) {
			console.log('Создание базы для отправленных картинок...');
		});
	}
});

// Функция добавления ссылок в базу
function addToSent(link) {
	fs.appendFile("sent.json", link + '\n');
	console.log("Отправлена картинка: " + link);
}

// Функция проверки ссылок в этой самой базе
function checkSent(link){
	var text = fs.readFileSync("sent.json").toString('utf-8');
	var textByLine = text.split("\n");
	textByLine.pop();
	if(textByLine.includes(link)) return true;
}

// Получение количества картинок в альбоме
function getCount(album){
	return new Promise(function (resolve) {
		// Делаем запрос к VK API
		request({
			url: "https://api.vk.com/method/photos.get?owner_id=" + config.vk_albums[album][0] + "&album_id=" + config.vk_albums[album][1] + "&count=0&v=5.67",
			json: true
		}, function(error, response, body) {
			// Проверяем, подходит нам ответ или нет
			if (!error && response.statusCode === 200 && body && !body.error) {
				// Возвращаем кол-во в случае успеха
				resolve(body.response.count);
			}else{
				resolve(false);
			}
		});
	});
}

// Получаем случайную картинку из этого альбома
function getRandomPhoto(count, album){
	// Создаем рандомное число для сдвига в альбоме
	var offset = Math.round(Math.random() * count);
	return new Promise(function (resolve) {
		// Запрос к API
		request({
			url: "https://api.vk.com/method/photos.get?owner_id=" + config.vk_albums[album][0] + "&album_id=" + config.vk_albums[album][1] + "&count=1&v=5.67&offset=" + offset,
			json: true
		}, function(error, response, body) {
			// Опять проверки
			if (!error && response.statusCode === 200 && body) {
				// Теперь проверки на длину  массива с картинками, которая должен быть равена 1 (для отлавливания ошибок)
				if(body.response.items.length){
					let photo;
					let info = body.response.items[0];
					// Страшная конструкция для получения самой большой картинки
					if(info.photo_1280){
						photo = info.photo_1280;
					}else if(info.photo_807){
						photo = info.photo_807;
					}else if(info.photo_604){
						photo = info.photo_604;
					}
					let ret = {"photo":photo};
					// Проверяем наличие описания у фото
					if(info.text) ret.text = info.text;
					// Возвращаем ответ со ссылкой и текстом, если он есть
					resolve(ret);
				}else{
					// Добавляем к счетчику ошибок +1
					toManyReqErr++
					console.log("Слишком много запросов. Ждем 2,5 секунды и повторяем. (" + toManyReqErr + ")");
					// Тут обработка ошибок. Если их много - оповещаем админа. Мало - пробуем опять
					if(toManyReqErr > config.error){
						let error = "Слишком много запросов! Возможно бот использовал почти все картинки из данного альбома.";
						bot.sendMessage(config.admin_id,error);
						console.log(error);
					}else{
						// Задержка повторения попытки, чтобы получать меньше ошибок
						setTimeout(function() {
							getRandomPhoto(count, album);
						}, config.delay*1000);
					}
				}
			}
		});
	});
}

// Собственно, функция для отправки картинок и обработки их
function sendPhoto(){
	// Получаем номер случайного альбома
	var album = Math.round(Math.random() * (config.vk_albums.length - 1));
	// Вызываем функцию получения кол-ва картинок в альбоме
	getCount(album).then(function (data) {
		// Проверка на то, точно ли получили мы описание фото
		if(data){
			// Обнуляем счетчик ошибок
			noPicsErr = 0;
			// Получаем случайное фото из альбома
			getRandomPhoto(data, album).then(function (data) {
				// Если его нет в нашей базе - отправляем в канал
				if(!checkSent(data.photo)){
					let text = {"caption":config.text};
					// Если в конфиге включена функция добавления текста из вк - добавляем его
					if(data.text && config.add_vk_text) text = {"caption":data.text + "\n" +  text};
					bot.sendPhoto(config.chat_id, data.photo, text).then(function() {
						addToSent(data.photo);
					});
				// Ищем новую картинку, если эта уже есть в базе
				}else{
					console.log("Эта картинка уже была, ищем новую");
					sendPhoto();
				}
			});
		// Если мы не получили описание картинки
		}else{
			// Добавляем +1 ко второму счетчику
			noPicsErr++
			console.log("Картинки не найдены... Попытка #" + noPicsErr);
			// И опять же оповещаем админа или повтораяем попытку
			if(noPicsErr > config.error){
				let error = "Бот не может получить картинки из альбома!";
				bot.sendMessage(config.admin_id,error);
				console.log(error);
			}else{
				sendPhoto();
			}
		}
	});
}

// Запускаем выполнение наших функций каждые N секунд
setInterval(function() {
	sendPhoto();
}, config.time*1000);
