extends Control

var game_state = "menu"

func _ready():
	$VBoxContainer/ButtonContainer/StartButton.pressed.connect(_on_start_button_pressed)

func _on_start_button_pressed():
	game_state = "playing"
	$VBoxContainer/GameContent/Status.text = "Game Started - Turn 1"
